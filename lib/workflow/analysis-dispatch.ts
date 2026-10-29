import { Agent, fetch as directFetch } from "undici";
import { taskErrorDetails } from "@/lib/billing/task-diagnostics";

const localDispatchAgent = new Agent();

export function analysisDispatchTarget() {
  const raw = process.env.NODE_ENV === "production"
    ? process.env.COMMERCIAL_RECONCILIATION_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
    : process.env.LOCAL_ANALYSIS_BASE_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url;
  } catch { return null; }
}

export async function dispatchAnalysisInvocation(input: { taskId: string } | { sceneJobId: string }) {
  const secret = process.env.CRON_SECRET;
  const baseUrl = analysisDispatchTarget();
  if (!secret || !baseUrl) {
    if (process.env.NODE_ENV === "production") console.error("analysis.dispatch.unconfigured", { ...input, hasSecret: Boolean(secret), hasBaseUrl: Boolean(baseUrl) });
    return false;
  }
  const startedAt = Date.now();
  try {
    const url = new URL("/api/internal/analysis-run", baseUrl);
    const request = {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    } as const;
    const response = baseUrl.protocol === "http:"
      ? await directFetch(url, { ...request, dispatcher: localDispatchAgent })
      : await fetch(url, request);
    // Read the small acknowledgement to completion. Cancelling a live response
    // can disconnect the invocation that still owns model/save work in after().
    try { await response.text(); }
    catch (error) { console.warn("analysis.dispatch.response_cleanup_failed", { ...input, error: taskErrorDetails(error) }); }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.info("analysis.dispatch.accepted", { ...input, requestMs: Date.now() - startedAt });
    return true;
  } catch (error) {
    console.error("analysis.dispatch.failed", { ...input, requestMs: Date.now() - startedAt, error: taskErrorDetails(error) });
    return false;
  }
}

export async function dispatchQueuedAnalysis(taskId: string) {
  return dispatchAnalysisInvocation({ taskId });
}
