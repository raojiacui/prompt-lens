/**
 * End-to-end lifecycle verification — drives the same service / storage /
 * executor stack the API routes use, without HTTP. Covers:
 *  create → plan → execute → artifacts → favorite → cancel → retry → delete,
 *  plus 404 / owner isolation / JSON-fallback persistence.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { JsonFileAgentStorage } from "@/lib/agent/storage";
import {
  createAgentRun,
  cancelAgentRun,
  retryAgentRun,
  deleteAgentRun,
  getAgentRun,
} from "@/lib/agent/service";
import { executeRun } from "@/lib/agent/executor";
import { AgentError } from "@/lib/agent/errors";
import { clearCancel } from "@/lib/agent/runtime";

const USER_A = "user-a";
const USER_B = "user-b";

describe("Agent E2E lifecycle", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-e2e-"));
  });

  it("full happy path: create → execute → artifacts → favorite toggle", async () => {
    const storage = new JsonFileAgentStorage(dir);

    // 1. Create (autoExecute=false so we control execution deterministically)
    const created = await createAgentRun(storage, USER_A, {
      userGoal: "Research TikTok skincare ad trends and create a video prompt",
      autoExecute: false,
    });
    expect(created.status).toBe("queued");
    expect(created.steps).toHaveLength(0);

    // 2. Execute synchronously (planner + all tools, no AI key → fallback)
    const done = await executeRun(created.id, storage, { userId: USER_A });
    expect(done.status).toBe("completed");
    expect(done.steps.length).toBeGreaterThanOrEqual(4);
    expect(done.steps.every((s) => s.status === "completed")).toBe(true);
    // every step has a toolCall record persisted
    expect(done.toolCalls.length).toBeGreaterThanOrEqual(done.steps.length);
    expect(done.toolCalls.every((c) => c.status === "completed")).toBe(true);

    // 3. Artifacts produced
    const types = done.artifacts.map((a) => a.type);
    expect(types).toContain("video_prompt");
    expect(types).toContain("shot_list");
    expect(types).toContain("research_report");
    expect(types).toContain("summary");

    const videoPrompt = done.artifacts.find((a) => a.type === "video_prompt")!;
    expect(videoPrompt.content.mainPrompt).toBeTruthy();
    expect(videoPrompt.content.negativePrompt).toBeTruthy();
    expect(Array.isArray(videoPrompt.content.shotList)).toBe(true);

    // 4. Favorite / unfavorite toggles persist
    const faved = await storage.updateArtifact(videoPrompt.id, { favorite: true });
    expect(faved?.favorite).toBe(true);
    const reloaded = await getAgentRun(storage, USER_A, done.id);
    expect(reloaded.artifacts.find((a) => a.id === videoPrompt.id)?.favorite).toBe(true);

    const unfaved = await storage.updateArtifact(videoPrompt.id, { favorite: false });
    expect(unfaved?.favorite).toBe(false);

    // 5. Persisted to disk (JSON fallback)
    const file = join(dir, "users", USER_A, "runs", `${done.id}.json`);
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.status).toBe("completed");
    expect(onDisk.artifacts.length).toBe(done.artifacts.length);
  });

  it("cancel mid-run then retry: cancelled steps reset and run resumes to completion", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const created = await createAgentRun(storage, USER_A, {
      userGoal: "Generate a launch video workflow for my new product",
      autoExecute: false,
    });

    // First execution: cancel after step 0 completes (signal fires on 3rd check)
    let checks = 0;
    const partial = await executeRun(created.id, storage, {
      userId: USER_A,
      isCancelled: () => {
        checks += 1;
        return checks >= 3;
      },
    });
    expect(partial.status).toBe("cancelled");
    expect(partial.steps[0].status).toBe("completed");

    // Retry: reset cancelled steps to queued (same as service.retryAgentRun),
    // then resume synchronously. We don't use retryAgentRun here because it
    // also starts a fire-and-forget background executor that races the test.
    clearCancel(created.id);
    for (const s of partial.steps) {
      if (s.status === "cancelled" || s.status === "failed") {
        await storage.updateStep(s.id, { status: "queued", startedAt: null, completedAt: null, errorMessage: null, outputSummary: null });
      }
    }
    await storage.updateRun(created.id, USER_A, { status: "queued", errorMessage: null, completedAt: null });

    const done = await executeRun(created.id, storage, { userId: USER_A, resume: true });
    expect(done.status).toBe("completed");
    expect(done.steps.every((s) => s.status === "completed")).toBe(true);
    expect(done.artifacts.some((a) => a.type === "summary")).toBe(true);
  });

  it("delete removes the run and its file; subsequent get is 404", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const created = await createAgentRun(storage, USER_A, {
      userGoal: "A run to delete",
      autoExecute: false,
    });
    const file = join(dir, "users", USER_A, "runs", `${created.id}.json`);
    expect(existsSync(file)).toBe(true);

    await deleteAgentRun(storage, USER_A, created.id);
    expect(existsSync(file)).toBe(false);
    await expect(getAgentRun(storage, USER_A, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("owner isolation: user B cannot see or act on user A's run", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const created = await createAgentRun(storage, USER_A, {
      userGoal: "private goal",
      autoExecute: false,
    });

    expect(await storage.getRun(created.id, USER_B)).toBeNull();
    await expect(getAgentRun(storage, USER_B, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(deleteAgentRun(storage, USER_B, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // User A still sees it
    const got = await getAgentRun(storage, USER_A, created.id);
    expect(got.id).toBe(created.id);
  });

  it("missing run returns 404 NOT_FOUND from all service actions", async () => {
    const storage = new JsonFileAgentStorage(dir);
    for (const fn of [
      () => getAgentRun(storage, USER_A, "missing"),
      () => cancelAgentRun(storage, USER_A, "missing"),
      () => retryAgentRun(storage, USER_A, "missing"),
      () => deleteAgentRun(storage, USER_A, "missing"),
    ]) {
      await expect(fn()).rejects.toBeInstanceOf(AgentError);
      const err = (await fn().catch((e) => e)) as AgentError;
      expect(err.code).toBe("NOT_FOUND");
      expect(err.status).toBe(404);
    }
  });

  it("survives a corrupted run file and a corrupted index without crashing", async () => {
    const storage = new JsonFileAgentStorage(dir);
    const created = await createAgentRun(storage, USER_A, {
      userGoal: "run that will be corrupted",
      autoExecute: false,
    });
    // Corrupt run file
    const file = join(dir, "users", USER_A, "runs", `${created.id}.json`);
    writeFileSync(file, "{ broken json ");
    // Corrupt index
    const idx = join(dir, "users", USER_A, "index.json");
    writeFileSync(idx, "not json at all");

    expect(await storage.getRun(created.id, USER_A)).toBeNull();
    await expect(storage.listRuns(USER_A)).resolves.toEqual([]);

    // A second run still works and is listed
    const second = await createAgentRun(storage, USER_A, {
      userGoal: "healthy run",
      autoExecute: false,
    });
    const list = await storage.listRuns(USER_A);
    expect(list.some((r) => r.id === second.id)).toBe(true);
  });
});
