/**
 * Agent 边界测试：
 *  - artifact favorite 的 storage 更新（内存 + JSON 文件）
 *  - run owner check（跨用户不可见/不可改/不可删）
 *  - missing run → 404 (NOT_FOUND)
 *  - cancel 后 resume/retry 能跑完
 *  - dirty JSON storage 不崩溃（损坏的 run/index 文件被安全跳过）
 *  - tool input schema 校验：非法输入返回 failed 而非抛异常
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { InMemoryAgentStorage, JsonFileAgentStorage } from "@/lib/agent/storage";
import {
  getAgentRun,
  deleteAgentRun,
  cancelAgentRun,
  retryAgentRun,
  executeAgentRun,
} from "@/lib/agent/service";
import { executeRun } from "@/lib/agent/executor";
import { AgentError } from "@/lib/agent/errors";
import { ALL_TOOLS, getTool } from "@/lib/agent/tools";
import { makeStorage, createRun, makeToolContext } from "./agent-test-utils";
import type { AgentArtifact } from "@/lib/agent/types";

function makeArtifact(overrides: Partial<AgentArtifact> = {}): AgentArtifact {
  const ts = new Date().toISOString();
  return {
    id: randomUUID(),
    runId: "run-1",
    type: "summary",
    title: "Test artifact",
    content: { summary: "hello" },
    metadata: {},
    favorite: false,
    createdAt: ts,
    ...overrides,
  };
}

describe("Agent boundary — artifact favorite", () => {
  it("InMemory: toggling favorite persists", async () => {
    const storage = makeStorage();
    const run = await createRun(storage);
    const art = makeArtifact({ runId: run.id });
    await storage.createArtifact(art);

    const faved = await storage.updateArtifact(art.id, { favorite: true });
    expect(faved?.favorite).toBe(true);

    const got = (await storage.getRun(run.id, run.userId))!;
    expect(got.artifacts[0].favorite).toBe(true);

    const unfaved = await storage.updateArtifact(art.id, { favorite: false });
    expect(unfaved?.favorite).toBe(false);
  });

  it("updateArtifact on missing id returns null (no throw)", async () => {
    const storage = makeStorage();
    const res = await storage.updateArtifact("does-not-exist", { favorite: true });
    expect(res).toBeNull();
  });

  it("JsonFile: favorite is written to disk and survives a new instance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fav-"));
    try {
      const storage = new JsonFileAgentStorage(dir);
      const run = await createRun(storage);
      const art = makeArtifact({ runId: run.id });
      await storage.createArtifact(art);
      await storage.updateArtifact(art.id, { favorite: true });

      // 落盘文件中应包含 favorite:true
      const file = join(dir, "users", run.userId, "runs", `${run.id}.json`);
      const onDisk = JSON.parse(readFileSync(file, "utf8"));
      expect(onDisk.artifacts[0].favorite).toBe(true);

      // 新实例读到的也是 favorite:true
      const storage2 = new JsonFileAgentStorage(dir);
      const reloaded = await storage2.getRun(run.id, run.userId);
      expect(reloaded?.artifacts[0].favorite).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Agent boundary — run owner check", () => {
  it("a user cannot read / update / delete another user's run", async () => {
    const storage = makeStorage();
    const run = await createRun(storage, { goal: "secret goal" });
    const other = "other-user";

    expect(await storage.getRun(run.id, other)).toBeNull();
    expect(await storage.updateRun(run.id, other, { status: "cancelled" })).toBeNull();
    expect(await storage.deleteRun(run.id, other)).toBe(false);

    // 列表不泄漏
    const others = await storage.listRuns(other);
    expect(others).toHaveLength(0);
    const mine = await storage.listRuns(run.userId);
    expect(mine).toHaveLength(1);
  });

  it("service layer throws NOT_FOUND (404) when accessing another user's run", async () => {
    const storage = makeStorage();
    const run = await createRun(storage);

    await expect(getAgentRun(storage, "intruder", run.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(deleteAgentRun(storage, "intruder", run.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("Agent boundary — missing run 404", () => {
  const cases: Array<[string, (s: InMemoryAgentStorage) => Promise<unknown>]> = [
    ["getAgentRun", (s) => getAgentRun(s, "u", "nope")],
    ["cancelAgentRun", (s) => cancelAgentRun(s, "u", "nope")],
    ["retryAgentRun", (s) => retryAgentRun(s, "u", "nope")],
    ["deleteAgentRun", (s) => deleteAgentRun(s, "u", "nope")],
    ["executeAgentRun", (s) => executeAgentRun(s, "u", "nope", { wait: true })],
  ];

  for (const [name, fn] of cases) {
    it(`${name} → AgentError NOT_FOUND / 404`, async () => {
      const storage = makeStorage();
      const err = await fn(storage).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe("NOT_FOUND");
      expect(agentErr.status).toBe(404);
    });
  }
});

describe("Agent boundary — cancel then resume", () => {
  it("a cancelled run resumes from the first incomplete step and completes", async () => {
    const storage = makeStorage();
    const run = await createRun(storage, { steps: "plan" });

    // 第一次执行：前两次 isCancelled 检查返回 false（进入循环 + 跑完 step 0），
    // 第三次返回 true，在 step 1 处取消。
    let checks = 0;
    const cancelled = await executeRun(run.id, storage, {
      userId: run.userId,
      isCancelled: () => {
        checks += 1;
        return checks >= 3;
      },
    });

    expect(cancelled.status).toBe("cancelled");
    const step0after = cancelled.steps[0];
    expect(step0after.status).toBe("completed");
    // 之后的步骤应为 cancelled
    expect(cancelled.steps.slice(1).every((s) => s.status === "cancelled")).toBe(true);

    // resume：已完成的步骤跳过，cancelled 的步骤重跑，最终 completed
    const resumed = await executeRun(run.id, storage, {
      userId: run.userId,
      resume: true,
      isCancelled: () => false,
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.steps.every((s) => s.status === "completed")).toBe(true);
    // 至少产出了汇总 artifact
    expect(resumed.artifacts.some((a) => a.type === "summary")).toBe(true);
  });
});

describe("Agent boundary — dirty JSON storage fallback", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-dirty-"));
  });

  it("a corrupted run file is skipped without throwing", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const run = await createRun(storage);
    // 写入半截 JSON
    const file = join(dir, "users", run.userId, "runs", `${run.id}.json`);
    writeFileSync(file, '{ "id": "broken", "steps": [ ', "utf8");

    // getRun 安全返回 null
    await expect(storage.getRun(run.id, run.userId)).resolves.toBeNull();
    // listRuns 不抛错，损坏的 run 被跳过
    await expect(storage.listRuns(run.userId)).resolves.toEqual([]);
  });

  it("a corrupted index file does not crash listRuns", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const run = await createRun(storage);
    const idx = join(dir, "users", run.userId, "index.json");
    writeFileSync(idx, "this is not json [", "utf8");

    const list = await storage.listRuns(run.userId);
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(0);
  });

  it("write after corruption heals (new run written and readable)", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const run = await createRun(storage);
    const idx = join(dir, "users", run.userId, "index.json");
    writeFileSync(idx, "{ corrupted", "utf8");

    const run2 = await createRun(storage, { goal: "second run" });
    const list = await storage.listRuns(run2.userId);
    expect(list.some((r) => r.id === run2.id)).toBe(true);
  });
});

describe("Agent boundary — tool schema validation", () => {
  it("every registered tool exposes safeParse on its inputSchema", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(7);
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.inputSchema.safeParse).toBe("function");
    }
  });

  it("web_search_mock rejects an empty query and returns failed result", async () => {
    const tool = getTool("web_search_mock")!;
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    const res = await tool.execute({}, makeToolContext());
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
  });

  it("web_search_mock rejects an over-long query", async () => {
    const tool = getTool("web_search_mock")!;
    const res = await tool.execute(
      { query: "x".repeat(600) },
      makeToolContext()
    );
    expect(res.success).toBe(false);
  });

  it("analyze_prompt_goal rejects missing userGoal", async () => {
    const tool = getTool("analyze_prompt_goal")!;
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    const res = await tool.execute({}, makeToolContext());
    expect(res.success).toBe(false);
  });

  it("call_existing_video_generate_api rejects a non-integer / out-of-range duration", async () => {
    const tool = getTool("call_existing_video_generate_api")!;
    const bad = await tool.execute(
      { prompt: "x", duration: 999 },
      makeToolContext()
    );
    expect(bad.success).toBe(false);
    const badType = await tool.execute(
      { prompt: "x", duration: "five" },
      makeToolContext()
    );
    expect(badType.success).toBe(false);
  });

  it("analyze_prompt_goal succeeds with a valid goal and stores a brief", async () => {
    const tool = getTool("analyze_prompt_goal")!;
    const ctx = makeToolContext();
    const res = await tool.execute(
      { userGoal: "Create a TikTok ad for my skincare serum" },
      ctx
    );
    expect(res.success).toBe(true);
    expect(ctx.sharedContext.brief).toBeTruthy();
    expect((ctx.sharedContext.brief as { industry: string }).industry).toMatch(/Skincare/i);
  });
});
