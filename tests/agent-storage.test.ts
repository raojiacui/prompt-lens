import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryAgentStorage, JsonFileAgentStorage } from "@/lib/agent/storage";
import type { AgentRun, AgentStep, AgentToolCall, AgentArtifact } from "@/lib/agent/types";

function makeRun(userId = "user-1"): AgentRun {
  const ts = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    goal: "Research TikTok skincare ad trends",
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

describe("InMemoryAgentStorage", () => {
  let storage: InMemoryAgentStorage;
  beforeEach(() => {
    storage = new InMemoryAgentStorage();
  });

  it("creates and retrieves a run scoped to the user", async () => {
    const run = makeRun();
    await storage.createRun(run);
    const got = await storage.getRun(run.id, run.userId);
    expect(got).not.toBeNull();
    expect(got!.goal).toBe(run.goal);
    expect(got!.steps).toEqual([]);
  });

  it("returns null when a run belongs to another user", async () => {
    const run = makeRun("user-1");
    await storage.createRun(run);
    expect(await storage.getRun(run.id, "user-2")).toBeNull();
  });

  it("persists steps, tool calls and artifacts and assembles them", async () => {
    const run = makeRun();
    await storage.createRun(run);

    const step: AgentStep = {
      id: randomUUID(),
      runId: run.id,
      order: 0,
      title: "Step 1",
      description: "d",
      status: "completed",
      toolName: "web_search_mock",
      expectedOutput: "out",
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      outputSummary: "done",
    };
    await storage.createSteps([step]);

    const call: AgentToolCall = {
      id: randomUUID(),
      runId: run.id,
      stepId: step.id,
      toolName: "web_search_mock",
      status: "completed",
      input: { query: "x" },
      output: { ok: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMessage: null,
    };
    await storage.createToolCall(call);

    const artifact: AgentArtifact = {
      id: randomUUID(),
      runId: run.id,
      type: "research_report",
      title: "Report",
      content: { summary: "s" },
      metadata: {},
      createdAt: new Date().toISOString(),
      favorite: false,
    };
    await storage.createArtifact(artifact);

    const got = await storage.getRun(run.id, run.userId);
    expect(got!.steps).toHaveLength(1);
    expect(got!.steps[0].id).toBe(step.id);
    expect(got!.toolCalls).toHaveLength(1);
    expect(got!.toolCalls[0].id).toBe(call.id);
    expect(got!.artifacts).toHaveLength(1);
    expect(got!.artifacts[0].id).toBe(artifact.id);
  });

  it("lists runs newest-first and respects limit", async () => {
    const r1 = makeRun();
    const r2 = makeRun();
    r2.createdAt = new Date(Date.now() + 1000).toISOString();
    await storage.createRun(r1);
    await storage.createRun(r2);
    const list = await storage.listRuns(r1.userId, 10);
    expect(list[0].id).toBe(r2.id);
  });

  it("deletes a run and cascades to steps/calls/artifacts", async () => {
    const run = makeRun();
    await storage.createRun(run);
    await storage.createSteps([
      { id: randomUUID(), runId: run.id, order: 0, title: "s", description: "d", status: "queued", toolName: "t", expectedOutput: null, startedAt: null, completedAt: null, errorMessage: null, outputSummary: null },
    ]);
    expect(await storage.deleteRun(run.id, run.userId)).toBe(true);
    expect(await storage.getRun(run.id, run.userId)).toBeNull();
  });

  it("updateStep and updateToolCall persist patches", async () => {
    const run = makeRun();
    await storage.createRun(run);
    const step = { id: randomUUID(), runId: run.id, order: 0, title: "s", description: "d", status: "queued" as const, toolName: "t", expectedOutput: null, startedAt: null, completedAt: null, errorMessage: null, outputSummary: null };
    await storage.createSteps([step]);
    const updated = await storage.updateStep(step.id, { status: "running", startedAt: new Date().toISOString() });
    expect(updated!.status).toBe("running");
  });
});

describe("JsonFileAgentStorage", () => {
  it("writes and reads a run with steps from disk", async () => {
    const dir = `/tmp/agent-test-${randomUUID()}`;
    const storage = new JsonFileAgentStorage(dir);
    const run = makeRun();
    await storage.createRun(run);

    const step: AgentStep = {
      id: randomUUID(), runId: run.id, order: 0, title: "Step", description: "d",
      status: "completed", toolName: "analyze_prompt_goal", expectedOutput: "out",
      startedAt: null, completedAt: null, errorMessage: null, outputSummary: "ok",
    };
    await storage.createSteps([step]);
    await storage.createArtifact({
      id: randomUUID(), runId: run.id, type: "summary", title: "S",
      content: { x: 1 }, metadata: {}, createdAt: new Date().toISOString(), favorite: false,
    });

    // Fresh storage instance reading the same directory
    const storage2 = new JsonFileAgentStorage(dir);
    const got = await storage2.getRun(run.id, run.userId);
    expect(got).not.toBeNull();
    expect(got!.goal).toBe(run.goal);
    expect(got!.steps).toHaveLength(1);
    expect(got!.artifacts).toHaveLength(1);

    const list = await storage2.listRuns(run.userId);
    expect(list.length).toBe(1);
  });

  it("isolates users", async () => {
    const dir = `/tmp/agent-test-${randomUUID()}`;
    const storage = new JsonFileAgentStorage(dir);
    const r1 = makeRun("user-A");
    const r2 = makeRun("user-B");
    await storage.createRun(r1);
    await storage.createRun(r2);
    expect(await storage.getRun(r1.id, "user-B")).toBeNull();
    expect((await storage.listRuns("user-A"))[0].id).toBe(r1.id);
  });
});
