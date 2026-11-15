import { taskErrorDetails } from "@/lib/billing/task-diagnostics";

const WAKE_TIMEOUT_MS = 15_000;
const MAX_WAKE_ATTEMPTS = 3;

export async function wakeReconciliationWorker(reason: string, fetcher: typeof fetch = fetch) {
  const workerUrl = process.env.FFMPEG_WORKER_URL?.replace(/\/$/, "");
  const workerSecret = process.env.FFMPEG_WORKER_SECRET;
  if (!workerUrl || !workerSecret) {
    console.warn("commercial.reconciliation.wake_skipped", { reason, configured: false });
    return false;
  }
  const startedAt = Date.now();
  // Repeating this notification only resets the scheduler's idle counter and
  // schedules a scan. It never submits a new model request or a new task.
  for (let attempt = 1; attempt <= MAX_WAKE_ATTEMPTS; attempt++) {
    const attemptStartedAt = Date.now();
    let status: number | undefined;
    try {
      const response = await fetcher(`${workerUrl}/scheduler/wake`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerSecret}` },
        signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
        redirect: "error",
        cache: "no-store",
      });
      status = response.status;
      // Only the status is needed; release the acknowledgement body on retries.
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`HTTP ${status}`);
      console.info("commercial.reconciliation.wake_succeeded", { reason, status, attempt, elapsedMs: Date.now() - startedAt });
      return true;
    } catch (error) {
      const diagnostic = taskErrorDetails(error);
      const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
      const detail = { reason, attempt, status, timeoutMs: WAKE_TIMEOUT_MS,
        attemptMs: Date.now() - attemptStartedAt, elapsedMs: Date.now() - startedAt,
        error: diagnostic.message, diagnostic };
      if (!retryable || attempt === MAX_WAKE_ATTEMPTS) {
        console.error("commercial.reconciliation.wake_failed", detail);
        return false;
      }
      const retryInMs = 1000 * attempt;
      console.warn("commercial.reconciliation.wake_retry", { ...detail, retryInMs });
      await new Promise(resolve => setTimeout(resolve, retryInMs));
    }
  }
  return false;
}
