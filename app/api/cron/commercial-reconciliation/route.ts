import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, paymentOrders, commercialTasks } from "@/lib/db";
import { reconcilePaymentOrder } from "@/lib/payments/xunhupay-reconciliation";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";
import { commercialConsumptionEnabled } from "@/lib/billing/commercial-analysis";
import { runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";

export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orders = await db.select({ id: paymentOrders.id, provider: paymentOrders.provider }).from(paymentOrders).where(and(sql`${paymentOrders.provider} IN ('xunhupay', 'alipay')`, eq(paymentOrders.status, "pending"), sql`${paymentOrders.createdAt} > now() - interval '24 hours'`)).orderBy(sql`COALESCE((${paymentOrders.metadata}->>'queryAfter')::bigint, 0)`, asc(paymentOrders.createdAt)).limit(3);
  let checked = 0;
  for (const order of orders) { try { if (order.provider === "alipay") await reconcileAlipayOrder(order.id); else await reconcilePaymentOrder(order.id); checked++; } catch { /* Keep uncertain orders pending for the next run. */ } }
  await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || '{"reconciliation":"manual_review"}'::jsonb` }).where(and(sql`${paymentOrders.provider} IN ('xunhupay', 'alipay')`, eq(paymentOrders.status, "pending"), sql`${paymentOrders.createdAt} < now() - interval '24 hours'`));
  if (commercialConsumptionEnabled()) {
    const generation = await db.select({ id: commercialTasks.id }).from(commercialTasks).where(and(eq(commercialTasks.kind, "generation"), eq(commercialTasks.state, "running"))).orderBy(sql`COALESCE((${commercialTasks.result}->>'queryAfter')::bigint, 0)`, asc(commercialTasks.updatedAt)).limit(3);
    for (const task of generation) { try { await reconcileCommercialGeneration(task.id); } catch { /* Leave an uncertain provider result reserved. */ } }
    await db.update(commercialTasks).set({ state: "review", updatedAt: new Date() }).where(and(eq(commercialTasks.state, "running"), sql`${commercialTasks.createdAt} < now() - interval '24 hours'`));
    const [queued] = await db.select({ id: commercialTasks.id }).from(commercialTasks).where(eq(commercialTasks.state, "queued")).orderBy(asc(commercialTasks.createdAt)).limit(1);
    if (queued) await runCommercialTask(queued.id);
  }
  return NextResponse.json({ checked }, { headers: { "Cache-Control": "no-store" } });
}
