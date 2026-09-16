import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { db, paymentOrders, commercialRefunds, commercialReservations, commercialWallets, commercialLedger, commercialTasks } from "@/lib/db";
import { settleCommercialTaskInTransaction } from "@/lib/billing/commercial-wallet";
import { commercialReadiness } from "@/lib/billing/commercial-readiness";
import { reconcilePaymentOrder } from "@/lib/payments/xunhupay-reconciliation";

export async function GET(request: NextRequest) {
  if (!await getAdminUserFromHeaders(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orders = await db.select({ id: paymentOrders.id, userId: paymentOrders.userId, amountCents: paymentOrders.amountCents, status: paymentOrders.status, createdAt: paymentOrders.createdAt, reconciliation: sql<string>`${paymentOrders.metadata}->>'reconciliation'` }).from(paymentOrders).where(and(eq(paymentOrders.provider, "xunhupay"), eq(paymentOrders.status, "pending"))).orderBy(asc(paymentOrders.createdAt)).limit(100);
  const refunds = await db.select({ id: commercialRefunds.id, orderId: commercialRefunds.orderId, userId: commercialRefunds.userId, state: commercialRefunds.state, reason: commercialRefunds.reason, createdAt: commercialRefunds.createdAt }).from(commercialRefunds).where(inArray(commercialRefunds.state, ["requested", "processing", "review"])).orderBy(asc(commercialRefunds.createdAt)).limit(100);
  const tasks = await db.select({ id: commercialReservations.id, userId: commercialReservations.userId, taskKey: commercialReservations.taskKey, credits: commercialReservations.credits, rewrites: commercialReservations.rewrites, createdAt: commercialReservations.createdAt }).from(commercialReservations).where(and(eq(commercialReservations.state, "held"), sql`${commercialReservations.createdAt} < now() - interval '24 hours'`)).orderBy(asc(commercialReservations.createdAt)).limit(100);
  const frozen = await db.select({ userId: commercialWallets.userId }).from(commercialWallets).where(eq(commercialWallets.frozen, true)).limit(100);
  return NextResponse.json({ orders, refunds, tasks, frozen, readiness: commercialReadiness() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminUserFromHeaders(request.headers);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.action === "release_unfulfilled_task") {
    if (!/^[0-9a-f-]{36}$/i.test(body.reservationId || "") || typeof body.evidence !== "string" || body.evidence.trim().length < 12 || body.evidence.length > 2000) return NextResponse.json({ error: "Evidence is required" }, { status: 400 });
    const reservation = await db.query.commercialReservations.findFirst({ where: eq(commercialReservations.id, body.reservationId) });
    if (!reservation || Date.now() - reservation.createdAt.getTime() < 86400000) return NextResponse.json({ error: "Reservation is not eligible for review" }, { status: 409 });
    try {
      await db.transaction(async (tx) => {
        if (reservation.taskKey.startsWith("commercial:")) await tx.select().from(commercialTasks).where(eq(commercialTasks.id, reservation.taskKey.slice(11))).for("update");
        const current = await tx.query.commercialReservations.findFirst({ where: eq(commercialReservations.id, reservation.id) });
        if (current?.state !== "held") throw new Error("Reservation is no longer held");
        await settleCommercialTaskInTransaction(tx, { userId: reservation.userId, taskKey: reservation.taskKey, credits: 0, rewrites: 0 });
        await tx.insert(commercialLedger).values({ userId: reservation.userId, eventKey: `review-release:${reservation.id}`, credits: 0, rewrites: 0, metadata: { actorId: admin.id, evidence: body.evidence.trim(), reservationId: reservation.id } }).onConflictDoNothing();
        if (reservation.taskKey.startsWith("commercial:")) await tx.update(commercialTasks).set({ state: "failed", result: sql`${commercialTasks.result} || '{"chargedCredits":0,"manualRelease":true}'::jsonb`, updatedAt: new Date() }).where(and(eq(commercialTasks.id, reservation.taskKey.slice(11)), eq(commercialTasks.userId, reservation.userId)));
      });
      return NextResponse.json({ success: true });
    } catch { return NextResponse.json({ error: "Reservation changed; refresh before reviewing" }, { status: 409 }); }
  }
  if (body?.action !== "query" || !/^[0-9a-f-]{36}$/i.test(body?.orderId || "")) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  await reconcilePaymentOrder(body.orderId);
  return NextResponse.json({ success: true });
}
