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
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://localhost:3001");
    vi.stubEnv("CRON_SECRET", "test-secret");
    findFirst.mockResolvedValue({ kind: "analysis", state: "queued" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(new URL("http://localhost:3001/api/internal/analysis-run"), expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-secret" }), body: JSON.stringify({ taskId: "task-id" }),
    }));
  });

  it("does not dispatch a task that is no longer queued", async () => {
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://localhost:3001");
    vi.stubEnv("CRON_SECRET", "test-secret");
    findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the local port when no development URL is configured", async () => {
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "");
    vi.stubEnv("PORT", "3002");
    vi.stubEnv("CRON_SECRET", "test-secret");
    findFirst.mockResolvedValue({ kind: "workflow_analysis", state: "queued" });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(true);
    expect(fetchMock.mock.calls[0][0].toString()).toBe("http://127.0.0.1:3002/api/internal/analysis-run");
  });
});
