/**
 * Agent Executor
 *
 * 负责执行 planner 生成的步骤：
 *  - 顺序执行，每步更新 step/toolCall 状态并持久化
 *  - 支持 cancel（通过 isCancelled 信号）
 *  - 支持 retry / resume（跳过已完成步骤，重跑失败步骤）
 *  - 支持部分完成：某步失败后 run=failed，但已完成步骤和 artifacts 仍可查看
 *  - completed 后由最后一步 save_agent_artifact 生成汇总
 *
 * Executor 不依赖 React / DOM，纯服务端逻辑，可在测试中直接调用。
 */

import { randomUUID } from "node:crypto";
import type {
  AgentRunDetail,
  AgentStep,
  AgentToolCall,
  ToolContext,
  ToolResult,
} from "./types";
import type { AgentStorage } from "./storage";
import { plan } from "./planner";
import { getTool, getToolNames } from "./tools";
import { AgentError } from "./errors";

export interface ExecuteOptions {
  /** 必须传入当前用户 id，用于存储层的用户隔离鉴权 */
  userId: string;
  /** resume=true 时跳过已完成步骤（retry/continue 使用） */
  resume?: boolean;
  /** 取消信号，由 runtime 注入 */
  isCancelled?: () => boolean;
}

function now() {
  return new Date().toISOString();
}

function isTerminal(run: AgentRunDetail): boolean {
  return run.status === "completed" || run.status === "cancelled";
}

/** 根据工具名和当前上下文，构造该工具的输入 */
function buildToolInput(
  toolName: string,
  run: AgentRunDetail,
  ctx: Record<string, unknown>
): Record<string, unknown> {
  const brief = (ctx.brief as Record<string, unknown>) || {};
  const videoPrompt = (ctx.videoPrompt as Record<string, unknown>) || {};
  const goal = run.goal;

  switch (toolName) {
    case "analyze_prompt_goal":
      return {
        userGoal: goal,
        attachments: run.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size })),
      };
    case "web_search_mock": {
      const industry = String(brief.industry || "");
      const platform = String(brief.platform || "tiktok");
      const query = [industry, goal].filter(Boolean).join(" ").slice(0, 200);
      return { query, platform, market: "global", locale: run.locale };
    }
    case "existing_history_lookup":
      return {
        query: [brief.industry, brief.platform, goal].filter(Boolean).join(" ").slice(0, 200),
        limit: 5,
      };
    case "generate_research_report":
      return {};
    case "create_video_prompt":
      return { extraDirection: goal };
    case "suggest_video_workflow":
      return { includeLaunchSequence: run.taskKind === "product_launch_video" };
    case "call_existing_analyze_api":
      return {};
    case "call_existing_video_generate_api":
      return {
        prompt: String(videoPrompt.mainPrompt || goal),
        negativePrompt: videoPrompt.negativePrompt ? String(videoPrompt.negativePrompt) : undefined,
        duration: 5,
        resolution: "720p",
        provider: "kie",
      };
    case "save_agent_artifact":
      return {};
    default:
      return {};
  }
}

export async function executeRun(
  runId: string,
  storage: AgentStorage,
  options: ExecuteOptions
): Promise<AgentRunDetail> {
  const isCancelled = options.isCancelled ?? (() => false);

  // 1. 加载 run（storage 按 userId 隔离）
  const run = await storage.getRun(runId, options.userId);
  if (!run) throw new AgentError("NOT_FOUND", "Agent run not found", 404);

  if (isTerminal(run) && !options.resume) {
    return run;
  }

  if (isCancelled()) {
    return finalizeCancel(run, storage);
  }

  // 2. 恢复共享上下文
  const sharedContext: Record<string, unknown> = {
    ...(run.context || {}),
    goal: run.goal,
  };

  // 3. 如无步骤，先执行 planner
  if (run.steps.length === 0) {
    await storage.updateRun(run.id, run.userId, { status: "planning" });
    run.status = "planning";

    const plannerResult = await plan({
      userGoal: run.goal,
      locale: run.locale,
      attachments: run.attachments,
      availableTools: getToolNames(),
      provider: run.provider,
      userId: run.userId,
    });

    const steps: AgentStep[] = plannerResult.steps.map((s, i) => ({
      id: randomUUID(),
      runId: run.id,
      order: i,
      title: s.title,
      description: s.description,
      status: "queued",
      toolName: s.toolName,
      expectedOutput: s.expectedOutput,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      outputSummary: null,
    }));

    await storage.createSteps(steps);
    run.steps = steps;
    run.taskKind = plannerResult.taskKind;
    run.metadata = { ...run.metadata, plannerUsedFallback: plannerResult.usedFallback };
    await storage.updateRun(run.id, run.userId, {
      status: "planning",
      taskKind: plannerResult.taskKind,
      metadata: run.metadata,
    });
  }

  // 4. 开始运行
  await storage.updateRun(run.id, run.userId, {
    status: "running",
    errorMessage: null,
    completedAt: null,
  });
  run.status = "running";

  // 5. 顺序执行步骤
  let failed = false;
  let failureMessage: string | null = null;

  for (let i = 0; i < run.steps.length; i++) {
    if (isCancelled()) {
      return finalizeCancel(run, storage, i);
    }

    const step = run.steps[i];

    // resume 时跳过已完成步骤
    if (options.resume && step.status === "completed") {
      continue;
    }

    // 重置失败/取消的步骤为 queued 再执行
    if (step.status === "failed" || step.status === "cancelled" || step.status === "skipped") {
      await storage.updateStep(step.id, {
        status: "queued",
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        outputSummary: null,
      });
      step.status = "queued";
    }
    if (step.status === "queued") {
      await storage.updateStep(step.id, { status: "running", startedAt: now(), errorMessage: null });
      step.status = "running";
      step.startedAt = now();
    }

    const toolName = step.toolName;
    if (!toolName) {
      await storage.updateStep(step.id, { status: "skipped", completedAt: now(), outputSummary: "No tool assigned." });
      step.status = "skipped";
      continue;
    }

    const tool = getTool(toolName);
    const toolInput = buildToolInput(toolName, run, sharedContext);

    // 创建 toolCall 记录
    const toolCallId = randomUUID();
    const toolCall: AgentToolCall = {
      id: toolCallId,
      runId: run.id,
      stepId: step.id,
      toolName,
      status: "running",
      input: toolInput,
      output: null,
      startedAt: now(),
      completedAt: null,
      errorMessage: null,
    };
    await storage.createToolCall(toolCall);

    let result: ToolResult;
    if (!tool) {
      result = { success: false, error: `Unknown tool: ${toolName}`, summary: `Unknown tool: ${toolName}` };
    } else {
      const ctx: ToolContext = {
        userId: run.userId,
        runId: run.id,
        stepId: step.id,
        locale: run.locale,
        attachments: run.attachments,
        sharedContext,
        saveArtifact: async (artifact) => {
          const created = {
            id: randomUUID(),
            runId: run.id,
            favorite: false,
            createdAt: now(),
            ...artifact,
          };
          await storage.createArtifact(created);
          return created;
        },
        findHistory: (query, limit) => storage.findRelevantHistory(run.userId, query, limit),
        isCancelled,
        log: (message, data) => {
          if (data !== undefined) {
            console.log(`[agent:${run.id}] ${message}`, typeof data === "object" ? JSON.stringify(data).slice(0, 500) : data);
          } else {
            console.log(`[agent:${run.id}] ${message}`);
          }
        },
      };

      try {
        result = await tool.execute(toolInput, ctx);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : "Tool execution failed",
          summary: "Tool threw an error.",
        };
      }
    }

    // 持久化 toolCall 结果
    if (result.success) {
      await storage.updateToolCall(toolCallId, {
        status: "completed",
        output: (result.data ?? {}) as Record<string, unknown>,
        completedAt: now(),
        errorMessage: null,
      });
      await storage.updateStep(step.id, {
        status: "completed",
        completedAt: now(),
        outputSummary: result.summary ?? "Completed.",
        errorMessage: null,
      });
      step.status = "completed";
      step.outputSummary = result.summary ?? "Completed.";
    } else {
      await storage.updateToolCall(toolCallId, {
        status: "failed",
        output: result.data ? (result.data as Record<string, unknown>) : null,
        completedAt: now(),
        errorMessage: result.error ?? "Tool failed",
      });
      await storage.updateStep(step.id, {
        status: "failed",
        completedAt: now(),
        errorMessage: result.error ?? "Tool failed",
        outputSummary: result.summary ?? "Failed.",
      });
      step.status = "failed";
      step.errorMessage = result.error ?? "Tool failed";
      failed = true;
      failureMessage = `Step "${step.title}" failed: ${result.error}`;
      break;
    }

    // 每步后持久化共享上下文，便于恢复
    await storage.updateRun(run.id, run.userId, { context: sharedContext });
  }

  // 6. 收尾
  if (isCancelled()) {
    return finalizeCancel(run, storage);
  }

  if (failed) {
    await storage.updateRun(run.id, run.userId, {
      status: "failed",
      errorMessage: failureMessage,
      completedAt: now(),
      context: sharedContext,
    });
    const failedRun = await storage.getRun(run.id, run.userId);
    return failedRun ?? run;
  }

  await storage.updateRun(run.id, run.userId, {
    status: "completed",
    completedAt: now(),
    errorMessage: null,
    context: sharedContext,
  });
  const completed = await storage.getRun(run.id, run.userId);
  return completed ?? run;
}

async function finalizeCancel(
  run: AgentRunDetail,
  storage: AgentStorage,
  fromStepIndex?: number
): Promise<AgentRunDetail> {
  // 把运行中的步骤标记为 cancelled
  if (fromStepIndex !== undefined) {
    for (let i = fromStepIndex; i < run.steps.length; i++) {
      const s = run.steps[i];
      if (s.status === "running" || s.status === "queued") {
        await storage.updateStep(s.id, { status: "cancelled", completedAt: now() });
      }
    }
  }
  await storage.updateRun(run.id, run.userId, { status: "cancelled", completedAt: now() });
  const updated = await storage.getRun(run.id, run.userId);
  return updated ?? run;
}
