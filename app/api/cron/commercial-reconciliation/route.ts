import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { analysisSceneJobs, apiRateLimits, db, paymentOrders, commercialTasks } from "@/lib/db";
import { expireTrialReservations } from "@/lib/usage/trial-quota";
import { recoverAnalysisTasks, runAnalysisTask } from "@/lib/workflow/analysis-tasks";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";
import { commercialConsumptionEnabled, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";
import { processMediaCleanupJobs } from "@/lib/workflow/media-cleanup";
import { escalateOverdueCommercialReviews, notifyDueCommercialReviews } from "@/lib/billing/commercial-review";
import { expireProjectMedia } from "@/lib/workflow/media-retention";
import { dispatchQueuedSceneJobs, reconcileTerminalIndependentAnalysis, recoverStaleAnalysisSceneJobs } from "@/lib/billing/independent-scene-analysis";
import { pruneAnalysisProviderSlots } from "@/lib/billing/analysis-provider-limit";

export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await recoverAnalysisTasks();
  await recoverCommercialAnalysisTasks();
  await expireTrialReservations();
  await db.delete(apiRateLimits).where(sql`${apiRateLimits.resetAt} < now() - interval '1 day'`);
  const orders = await db.select({ id: paymentOrders.id }).from(paymentOrders).where(and(eq(paymentOrders.provider, "alipay"), eq(paymentOrders.status, "pending"))).orderBy(sql`COALESCE((${paymentOrders.metadata}->>'queryAfter')::bigint, 0)`, asc(paymentOrders.createdAt)).limit(20);
  let checked = 0;
  for (const order of orders) { try { await reconcileAlipayOrder(order.id); checked++; } catch { /* Keep uncertain orders pending for the next run. */ } }
  await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || '{"reconciliation":"manual_review"}'::jsonb` }).where(and(eq(paymentOrders.provider, "alipay"), eq(paymentOrders.status, "pending"), sql`${paymentOrders.createdAt} < now() - interval '24 hours'`));
  if (commercialConsumptionEnabled()) {
    await escalateOverdueCommercialReviews(20);
    await notifyDueCommercialReviews(20);
    await recoverStaleAnalysisSceneJobs(20);
    await reconcileTerminalIndependentAnalysis(undefined, 20);
    await dispatchQueuedSceneJobs();
    await pruneAnalysisProviderSlots();
    const generation = await db.select({ id: commercialTasks.id }).from(commercialTasks).where(and(eq(commercialTasks.kind, "generation"), eq(commercialTasks.state, "running"))).orderBy(sql`COALESCE((${commercialTasks.result}->>'queryAfter')::bigint, 0)`, asc(commercialTasks.updatedAt)).limit(3);
    for (const task of generation) { try { await reconcileCommercialGeneration(task.id); } catch { /* Leave an uncertain provider result reserved. */ } }
  }
  const [queued] = await db.select({ id: commercialTasks.id, kind: commercialTasks.kind }).from(commercialTasks).where(and(
    eq(commercialTasks.state, "queued"),
    commercialConsumptionEnabled() ? undefined : eq(commercialTasks.kind, "workflow_analysis"),
  )).orderBy(asc(commercialTasks.updatedAt)).limit(1);
  if (queued?.kind === "workflow_analysis") await runAnalysisTask(queued.id);
  else if (queued && commercialConsumptionEnabled()) await runCommercialTask(queued.id);
  const retention = await expireProjectMedia(10);
  await processMediaCleanupJobs(10);
  const [activeTasks, activeSceneJobs] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(commercialTasks).where(or(
      inArray(commercialTasks.state, ["queued", "running"]),
      and(eq(commercialTasks.state, "review"), sql`jsonb_typeof(${commercialTasks.result}->'pendingResult') = 'object'`),
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(analysisSceneJobs).where(inArray(analysisSceneJobs.state, ["queued", "running"])),
  ]);
  const work = { tasks: activeTasks[0]?.count || 0, sceneJobs: activeSceneJobs[0]?.count || 0 };
  return NextResponse.json({ checked, retention, work, workRemaining: work.tasks + work.sceneJobs > 0 }, { headers: { "Cache-Control": "no-store" } });
}
