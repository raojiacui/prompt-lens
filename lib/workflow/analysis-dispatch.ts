import { and, eq } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";

function dispatchBaseUrl() {
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

export async function dispatchQueuedAnalysis(taskId: string) {
  const secret = process.env.CRON_SECRET;
  const baseUrl = dispatchBaseUrl();
  if (!secret || !baseUrl) {
    if (process.env.NODE_ENV === "production") console.error("analysis.dispatch.unconfigured", { taskId, hasSecret: Boolean(secret), hasBaseUrl: Boolean(baseUrl) });
    return false;
  }
  try {
    const task = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, taskId), eq(commercialTasks.state, "queued")) });
    if (!task || !["analysis", "workflow_analysis"].includes(task.kind)) return false;
    const response = await fetch(new URL("/api/internal/analysis-run", baseUrl), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.error("analysis.dispatch.failed", { taskId, message: error instanceof Error ? error.message : "Unknown error" });
    return false;
  }
}
