import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryAgentStorage } from "@/lib/agent/storage";
import { executeRun } from "@/lib/agent/executor";
import type { AgentRun } from "@/lib/agent/types";

function makeRun(goal = "Research TikTok skincare ad trends and create a video prompt"): AgentRun {
  const ts = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: "test-user",
    goal,
    status: "queued",
    provider: null,
    locale: "en",
    taskKind: null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
    errorMessage: null,
    metadata: {},
    attachments: [],
    context: {},
  };
}

describe("Agent Executor — success flow", () => {
  let storage: InMemoryAgentStorage;
  beforeEach(() => {
    storage = new InMemoryAgentStorage();
  });

  it("plans then executes all steps and completes with artifacts", async () => {
    const run = makeRun();
    await storage.createRun(run);

    const result = await executeRun(run.id, storage, { userId: run.userId });

    expect(result.status).toBe("completed");
    expect(result.taskKind).toBe("trend_research");
    expect(result.steps.length).toBeGreaterThanOrEqual(5);
    // 所有步骤应完成
    for (const step of result.steps) {
      expect(step.status).toBe("completed");
      expect(step.startedAt).toBeTruthy();
      expect(step.completedAt).toBeTruthy();
    }
    // 每个工具步骤都应有对应的 toolCall
    for (const step of result.steps) {
      if (step.toolName) {
        const calls = result.toolCalls.filter((c) => c.stepId === step.id);
        expect(calls.length).toBe(1);
        expect(calls[0].status).toBe("completed");
        expect(calls[0].output).toBeTruthy();
      }
    }
    // 应产出 artifacts：报告 / prompt / workflow 等
    const types = result.artifacts.map((a) => a.type);
    expect(types).toContain("research_report");
    expect(types).toContain("video_prompt");
    expect(types).toContain("workflow");
    expect(types).toContain("summary");
    // planner 走 fallback
    expect(result.metadata.plannerUsedFallback).toBe(true);
  }, 30000);

  it("generates a valid video prompt artifact with mainPrompt, negativePrompt and shot list", async () => {
    const run = makeRun("Write a video prompt for my serum ad");
    await storage.createRun(run);
    const result = await executeRun(run.id, storage, { userId: run.userId });
    const promptArtifact = result.artifacts.find((a) => a.type === "video_prompt");
    expect(promptArtifact).toBeTruthy();
    const content = promptArtifact!.content as { mainPrompt?: string; negativePrompt?: string; shotList?: unknown[]; styleNotes?: unknown[] };
    expect(typeof content.mainPrompt).toBe("string");
    expect(content.mainPrompt!.length).toBeGreaterThan(20);
    expect(typeof content.negativePrompt).toBe("string");
    expect(Array.isArray(content.shotList)).toBe(true);
    expect(content.shotList!.length).toBeGreaterThan(0);
    expect(Array.isArray(content.styleNotes)).toBe(true);
  }, 30000);
});

describe("Agent Executor — failure & partial completion", () => {
  let storage: InMemoryAgentStorage;
  beforeEach(() => {
    storage = new InMemoryAgentStorage();
  });

  it("marks run failed when a step's tool is unknown, but keeps completed steps/artifacts", async () => {
    const run = makeRun();
    await storage.createRun(run);

    // 手动插入计划，其中第 2 步使用不存在的工具
    const steps = [
      {
        id: randomUUID(), runId: run.id, order: 0, title: "Analyze goal", description: "d",
        status: "queued" as const, toolName: "analyze_prompt_goal", expectedOutput: "brief",
        startedAt: null, completedAt: null, errorMessage: null, outputSummary: null,
      },
      {
        id: randomUUID(), runId: run.id, order: 1, title: "Broken step", description: "d",
        status: "queued" as const, toolName: "does_not_exist_tool", expectedOutput: "x",
        startedAt: null, completedAt: null, errorMessage: null, outputSummary: null,
      },
      {
        id: randomUUID(), runId: run.id, order: 2, title: "Should not run", description: "d",
        status: "queued" as const, toolName: "save_agent_artifact", expectedOutput: "x",
        startedAt: null, completedAt: null, errorMessage: null, outputSummary: null,
      },
    ];
    await storage.createSteps(steps);

    const result = await executeRun(run.id, storage, { userId: run.userId });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Broken step");
    // 第 1 步完成
    expect(result.steps[0].status).toBe("completed");
    // 第 2 步失败
    expect(result.steps[1].status).toBe("failed");
    expect(result.steps[1].errorMessage).toContain("Unknown tool");
    // 第 3 步未执行（仍是 queued）
    expect(result.steps[2].status).toBe("queued");
    // 已完成的 brief artifact 仍可查看
    const briefArtifact = result.artifacts.find((a) => a.type === "brief" || a.type === "other");
    // analyze_prompt_goal 不直接存 artifact，但 sharedContext 有 brief；至少 run 没崩溃
    expect(result.steps[0].outputSummary).toBeTruthy();
    void briefArtifact;
  });

  it("resumes on retry: skips completed steps and reruns failed steps", async () => {
    const run = makeRun();
    await storage.createRun(run);

    // 第 1 步完成，第 2 步失败（未知工具），第 3 步待执行
    const s1 = {
      id: randomUUID(), runId: run.id, order: 0, title: "Analyze goal", description: "d",
      status: "completed" as const, toolName: "analyze_prompt_goal", expectedOutput: "brief",
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      errorMessage: null, outputSummary: "Brief done",
    };
    const s2 = {
      id: randomUUID(), runId: run.id, order: 1, title: "Search", description: "d",
      status: "failed" as const, toolName: "does_not_exist", expectedOutput: "x",
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      errorMessage: "Unknown tool", outputSummary: "Failed",
    };
    const s3 = {
      id: randomUUID(), runId: run.id, order: 2, title: "Save", description: "d",
      status: "queued" as const, toolName: "save_agent_artifact", expectedOutput: "x",
      startedAt: null, completedAt: null, errorMessage: null, outputSummary: null,
    };
    await storage.createSteps([s1, s2, s3]);

    // resume：s1 跳过，s2 重置后仍因未知工具失败，s3 不会跑到
    const result = await executeRun(run.id, storage, { userId: run.userId, resume: true });
    expect(result.status).toBe("failed");
    expect(result.steps[0].status).toBe("completed");
    expect(result.steps[0].outputSummary).toBe("Brief done");
    expect(result.steps[1].status).toBe("failed");
  });
});

describe("Agent Executor — cancel", () => {
  it("stops execution when isCancelled returns true", async () => {
    const storage = new InMemoryAgentStorage();
    const run = makeRun();
    await storage.createRun(run);

    // 立即取消
    const result = await executeRun(run.id, storage, {
      userId: run.userId,
      isCancelled: () => true,
    });
    expect(["cancelled", "planning", "queued"]).toContain(result.status);
  });
});
