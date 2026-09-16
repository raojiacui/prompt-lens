import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, like } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, commercialWallets, commercialReservations, commercialLedger, commercialRefunds, paymentOrders } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const [wallet] = await db.select().from(commercialWallets).where(eq(commercialWallets.userId, userId));
  const orders = await db.select({ id: paymentOrders.id, packageId: paymentOrders.packageId, packageName: paymentOrders.packageName, amountCents: paymentOrders.amountCents, status: paymentOrders.status, createdAt: paymentOrders.createdAt, paidAt: paymentOrders.paidAt }).from(paymentOrders)
    .where(and(eq(paymentOrders.userId, userId), like(paymentOrders.packageId, "v6_%"))).orderBy(desc(paymentOrders.createdAt)).limit(100);
  const tasks = await db.select({ id: commercialReservations.id, taskKey: commercialReservations.taskKey, state: commercialReservations.state, credits: commercialReservations.credits, rewrites: commercialReservations.rewrites, settledCredits: commercialReservations.settledCredits, settledRewrites: commercialReservations.settledRewrites, createdAt: commercialReservations.createdAt }).from(commercialReservations).where(eq(commercialReservations.userId, userId)).orderBy(desc(commercialReservations.createdAt)).limit(100);
  const ledger = await db.select({ id: commercialLedger.id, eventKey: commercialLedger.eventKey, credits: commercialLedger.credits, rewrites: commercialLedger.rewrites, createdAt: commercialLedger.createdAt }).from(commercialLedger).where(eq(commercialLedger.userId, userId)).orderBy(desc(commercialLedger.createdAt)).limit(100);
  const refunds = await db.select({ id: commercialRefunds.id, orderId: commercialRefunds.orderId, state: commercialRefunds.state }).from(commercialRefunds).where(eq(commercialRefunds.userId, userId));
  return NextResponse.json({ wallet: wallet ?? { credits: 0, rewrites: 0, heldCredits: 0, heldRewrites: 0, frozen: false }, orders, tasks, ledger, refunds }, { headers: { "Cache-Control": "private, no-store" } });
}
