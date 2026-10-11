import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";
import { commercialConsumptionEnabled, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { recoverAnalysisTasks } from "@/lib/workflow/analysis-tasks";
import { dispatchQueuedAnalysis } from "@/lib/workflow/analysis-dispatch";
import { escalateOverdueCommercialReviews, notifyDueCommercialReviews } from "@/lib/billing/commercial-review";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dispatchReady = sql`(${commercialTasks.result}->>'nextDispatchAt' IS NULL OR (${commercialTasks.result}->>'nextDispatchAt')::timestamptz <= now())`;
  const queued = await db.select({ id: commercialTasks.id, result: commercialTasks.result }).from(commercialTasks).where(and(
    eq(commercialTasks.state, "queued"),
    inArray(commercialTasks.kind, commercialConsumptionEnabled() ? ["analysis", "workflow_analysis"] : ["workflow_analysis"]),
    dispatchReady,
  )).orderBy(sql`(${commercialTasks.result}->>'lastDispatchAt')::timestamptz ASC NULLS FIRST`, asc(commercialTasks.updatedAt)).limit(5);
  const dispatched = await Promise.all(queued.map(async task => {
    try {
      const now = new Date();
      const result = task.result as Record<string, unknown>;
      const [claimed] = await db.update(commercialTasks).set({ result: sql`${commercialTasks.result} || ${JSON.stringify({ lastDispatchAt: now.toISOString(), nextDispatchAt: new Date(now.getTime() + 2 * 60_000).toISOString(), dispatchAttempts: Number(result.dispatchAttempts || 0) + 1 })}::jsonb` }).where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "queued"), dispatchReady)).returning({ id: commercialTasks.id });
      return claimed ? dispatchQueuedAnalysis(task.id) : false;
    } catch (error) {
      console.error("analysis.dispatch_cron.task_failed", { taskId: task.id, error });
      return false;
    }
  }));
  const accepted = dispatched.filter(Boolean).length;
  const recoveryErrors: string[] = [];
  if (commercialConsumptionEnabled()) {
    try { await escalateOverdueCommercialReviews(5); await notifyDueCommercialReviews(5); }
    catch (error) { console.error("analysis.dispatch_cron.review_escalation_failed", error); recoveryErrors.push("review_escalation"); }
  }
  const deadline = Date.now() + 40_000;
  try { await recoverAnalysisTasks({ dispatch: false, limit: 1, deadline }); }
  catch (error) {
    console.error("analysis.dispatch_cron.workflow_recovery_failed", error);
    recoveryErrors.push("workflow_analysis");
  }
  if (commercialConsumptionEnabled() && Date.now() < deadline) {
    try { await recoverCommercialAnalysisTasks(undefined, { dispatch: false, limit: 1, deadline }); }
    catch (error) {
      console.error("analysis.dispatch_cron.commercial_recovery_failed", error);
      recoveryErrors.push("analysis");
    }
  }
  console.info("analysis.dispatch_cron.completed", { scanned: queued.length, accepted, recoveryErrors });
  return NextResponse.json({ scanned: queued.length, accepted, recoveryErrors }, { headers: { "Cache-Control": "no-store" } });
}
