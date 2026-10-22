export async function wakeReconciliationWorker(reason: string, fetcher: typeof fetch = fetch) {
  const workerUrl = process.env.FFMPEG_WORKER_URL?.replace(/\/$/, "");
  const workerSecret = process.env.FFMPEG_WORKER_SECRET;
  if (!workerUrl || !workerSecret) {
    console.warn("commercial.reconciliation.wake_skipped", { reason, configured: false });
    return false;
  }
  try {
    const response = await fetcher(`${workerUrl}/scheduler/wake`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerSecret}` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.info("commercial.reconciliation.wake_succeeded", { reason, status: response.status });
    return true;
  } catch (error) {
    console.error("commercial.reconciliation.wake_failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
