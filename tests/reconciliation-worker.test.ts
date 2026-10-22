import { afterEach, expect, it, vi } from "vitest";
import { wakeReconciliationWorker } from "@/lib/billing/reconciliation-worker";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("wakes the configured worker with its bearer secret", async () => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example/");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-secret");
  vi.spyOn(console, "info").mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });

  await expect(wakeReconciliationWorker("test", fetcher as typeof fetch)).resolves.toBe(true);
  expect(fetcher).toHaveBeenCalledWith("https://worker.example/scheduler/wake", expect.objectContaining({
    method: "POST",
    headers: { Authorization: "Bearer worker-secret" },
  }));
});

it("does not fail task submission when the worker cannot be woken", async () => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

  await expect(wakeReconciliationWorker("test", fetcher as typeof fetch)).resolves.toBe(false);
});
