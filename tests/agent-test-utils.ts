/** Agent 测试共享工具：构造 ToolContext、InMemory storage、一个 run */
import { randomUUID } from "node:crypto";
import { InMemoryAgentStorage } from "@/lib/agent/storage";
import type { AgentStorage } from "@/lib/agent/storage";
import { plan } from "@/lib/agent/planner";
import { getToolNames } from "@/lib/agent/tools";
import type { AgentAttachment, AgentRun, ToolContext } from "@/lib/agent/types";

export function makeStorage() {
  return new InMemoryAgentStorage();
}

export async function createRun(
  storage: AgentStorage,
  opts: { goal?: string; locale?: string; attachments?: AgentAttachment[]; steps?: "plan" | "none" } = {}
): Promise<AgentRun> {
  const ts = new Date().toISOString();
  const run: AgentRun = {
    id: randomUUID(),
    userId: "test-user",
    goal: opts.goal ?? "Research TikTok skincare ad trends and create a video prompt",
    status: "queued",
    provider: null,
    locale: opts.locale ?? "en",
    taskKind: null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
    errorMessage: null,
    metadata: {},
    attachments: opts.attachments ?? [],
    context: {},
  };
  await storage.createRun(run);
  if (opts.steps === "plan") {
    const result = await plan({
      userGoal: run.goal,
      locale: run.locale,
      attachments: run.attachments,
      availableTools: getToolNames(),
      provider: run.provider,
      userId: run.userId,
    });
    // 直接写入内存存储的 steps（不走 DB schema）
    const steps = result.steps.map((s, i) => ({
      id: randomUUID(),
      runId: run.id,
      order: i,
      title: s.title,
      description: s.description,
      status: "queued" as const,
      toolName: s.toolName,
      expectedOutput: s.expectedOutput,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      outputSummary: null,
    }));
    await storage.createSteps(steps);
  }
  return run;
}

export function makeToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const saved: ToolContext["saveArtifact"] = overrides.saveArtifact ?? (async (a) => ({
    id: randomUUID(),
    runId: "run-1",
    favorite: false,
    createdAt: new Date().toISOString(),
    ...a,
  }));
  return {
    userId: "test-user",
    runId: "run-1",
    stepId: "step-1",
    locale: "en",
    attachments: [],
    sharedContext: {},
    saveArtifact: saved,
    findHistory: overrides.findHistory ?? (async () => []),
    isCancelled: overrides.isCancelled ?? (() => false),
    log: overrides.log ?? (() => {}),
  };
}
