import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { wakeReconciliationWorker } from "@/lib/billing/reconciliation-worker";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example/");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-secret");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("wakes the configured worker with its bearer secret", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  await expect(wakeReconciliationWorker("test", fetcher)).resolves.toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith("https://worker.example/scheduler/wake", expect.objectContaining({
    method: "POST", headers: { Authorization: "Bearer worker-secret" }, redirect: "error",
  }));
});

it("recovers from the actual 15-second timeout with a fresh signal and delayed retry", async () => {
  // Native AbortSignal.timeout is not driven by fake timers. Model its abort
  // while preserving the fetch/abort interaction rather than rejecting at once.
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  const fetcher = vi.fn<typeof fetch>()
    .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }))
    .mockResolvedValueOnce(new Response("{}"));
  const result = wakeReconciliationWorker("workflow_analysis", fetcher);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(console.error).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1]!.signal).not.toBe(fetcher.mock.calls[0][1]!.signal);
  expect(fetcher.mock.calls[1][1]!.signal!.aborted).toBe(false);
  expect(console.info).toHaveBeenCalledWith("commercial.reconciliation.wake_succeeded", expect.objectContaining({ attempt: 2, elapsedMs: 16000 }));
});

it.each([408, 429, 502, 503])("retries temporary HTTP %i responses", async status => {
  const rejected = new Response("temporary", { status });
  const fetcher = vi.fn().mockResolvedValueOnce(rejected).mockResolvedValueOnce(new Response("{}"));
  const result = wakeReconciliationWorker("test", fetcher);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(rejected.body!.locked).toBe(false);
  expect(rejected.bodyUsed).toBe(true);
});

it.each([401, 403, 404])("does not retry permanent HTTP %i configuration errors", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
  await expect(wakeReconciliationWorker("test", fetcher)).resolves.toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(console.warn).not.toHaveBeenCalled();
});

it("bounds retries, resolves false and logs sanitized network diagnostics", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed https://private.example?secret=worker-secret", {
    cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
  }));
  const result = wakeReconciliationWorker("test", fetcher);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(result).resolves.toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.error).toHaveBeenCalledOnce();
  expect(console.error).toHaveBeenCalledWith("commercial.reconciliation.wake_failed", expect.objectContaining({
    attempt: 3, elapsedMs: 3000, diagnostic: expect.objectContaining({ name: "TypeError", cause: expect.objectContaining({ code: "ECONNREFUSED" }) }),
  }));
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("worker-secret");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private.example");
});

it("does not send requests when worker configuration is missing", async () => {
  vi.stubEnv("FFMPEG_WORKER_SECRET", "");
  const fetcher = vi.fn();
  await expect(wakeReconciliationWorker("test", fetcher)).resolves.toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
