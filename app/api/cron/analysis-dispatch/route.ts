import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";
import { commercialConsumptionEnabled, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { recoverAnalysisTasks } from "@/lib/workflow/analysis-tasks";
import { dispatchQueuedAnalysis } from "@/lib/workflow/analysis-dispatch";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queued = await db.select({ id: commercialTasks.id }).from(commercialTasks).where(and(
    eq(commercialTasks.state, "queued"),
    inArray(commercialTasks.kind, commercialConsumptionEnabled() ? ["analysis", "workflow_analysis"] : ["workflow_analysis"]),
  )).orderBy(asc(commercialTasks.updatedAt)).limit(5);
  const dispatched = await Promise.all(queued.map(task => dispatchQueuedAnalysis(task.id)));
  const accepted = dispatched.filter(Boolean).length;
  const recoveryErrors: string[] = [];
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
