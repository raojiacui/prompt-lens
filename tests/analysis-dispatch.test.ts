import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ localFetch: vi.fn() }));
vi.mock("undici", async importOriginal => ({ ...await importOriginal<typeof import("undici")>(), fetch: mocks.localFetch }));

import { dispatchQueuedAnalysis } from "@/lib/workflow/analysis-dispatch";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.localFetch.mockReset(); });

describe("analysis continuation", () => {
  it("starts the next queued step on the same deployment without a browser poll", async () => {
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://localhost:3001");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    mocks.localFetch.mockImplementation(fetchMock);
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(new URL("http://localhost:3001/api/internal/analysis-run"), expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-secret" }), body: JSON.stringify({ taskId: "task-id" }),
    }));
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("treats a failed dispatch as retryable by the task status path", async () => {
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://localhost:3001");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
    mocks.localFetch.mockImplementation(fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses the local port when no development URL is configured", async () => {
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "");
    vi.stubEnv("PORT", "3002");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
    mocks.localFetch.mockImplementation(fetchMock);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(true);
    expect(fetchMock.mock.calls[0][0].toString()).toBe("http://127.0.0.1:3002/api/internal/analysis-run");
  });
  it.each([200, 503])("releases the acknowledgement body for HTTP %s", async status => {
    vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://localhost:3001");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const cancel = vi.fn(async () => {});
    mocks.localFetch.mockResolvedValue({ ok: status === 200, status, body: { cancel } });
    expect(await dispatchQueuedAnalysis("task-id")).toBe(status === 200);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("uses the deployment fetch for a production HTTPS target", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMMERCIAL_RECONCILIATION_BASE_URL", "https://example.com");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const globalFetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", globalFetch);
    expect(await dispatchQueuedAnalysis("task-id")).toBe(true);
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(mocks.localFetch).not.toHaveBeenCalled();
  });
});
