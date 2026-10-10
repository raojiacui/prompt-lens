import { afterEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn());
vi.mock("drizzle-orm", () => ({ and: (...conditions: unknown[]) => conditions, eq: (...values: unknown[]) => values }));
vi.mock("@/lib/db", () => ({
  commercialTasks: { id: "id", state: "state" },
  db: { query: { commercialTasks: { findFirst } } },
}));

import { dispatchQueuedAnalysis } from "@/lib/workflow/analysis-dispatch";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); findFirst.mockReset(); });

describe("analysis continuation", () => {
  it("starts the next queued step on the same deployment without a browser poll", async () => {
    vi.stubEnv("VERCEL_URL", "prompt.example.com");
    vi.stubEnv("CRON_SECRET", "test-secret");
    findFirst.mockResolvedValue({ kind: "analysis", state: "queued" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(new URL("https://prompt.example.com/api/internal/analysis-run"), expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-secret" }), body: JSON.stringify({ taskId: "task-id" }),
    }));
  });

  it("does not dispatch a task that is no longer queued", async () => {
    vi.stubEnv("VERCEL_URL", "prompt.example.com");
    vi.stubEnv("CRON_SECRET", "test-secret");
    findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
