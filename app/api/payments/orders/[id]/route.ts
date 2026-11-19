import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, paymentOrders } from "@/lib/db";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";
import { alipayOrderDeadline } from "@/lib/payments/order-expiry";
import { reconcileWaffoOrder } from "@/lib/payments/waffo-reconciliation";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  // Opening a saved checkout should not wait for the provider's network query.
  // The normal status poll still reconciles and verifies any completed payment.
  if (request.nextUrl.searchParams.get("snapshot") !== "1") {
    await reconcileAlipayOrder(id, session.user.id);
    try { await reconcileWaffoOrder(id, session.user.id); } catch { /* Leave uncertain payments pending. */ }
  }
  const order = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id)) });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const deadline = order.provider === "waffo" ? new Date(order.createdAt.getTime() + 86400_000) : alipayOrderDeadline(order.createdAt);
  const expired = Date.now() >= deadline.getTime();
  const cancellationRequested = (order.metadata as Record<string, unknown>).cancellationRequested === true;
  const paymentIssue = (order.metadata as Record<string, unknown>).paymentReview ?? (order.status === "pending" ? (order.metadata as Record<string, unknown>).queryError ?? null : null);
  const officialPaymentUrl = order.provider === "alipay" && order.status === "pending" && !expired && !cancellationRequested && !paymentIssue ? `/api/payments/orders/${order.id}/pay` : null;
  return NextResponse.json({
    id: order.id, orderId: order.id, provider: order.provider, status: order.status, packageName: order.packageName,
    expiresAt: deadline.toISOString(),
    amountCents: order.amountCents, currency: order.currency, credits: order.credits,
    rewrites: (order.metadata as Record<string, unknown>).rewrites ?? 0,
    paidAt: order.paidAt,
    paymentIssue,
    qrImageUrl: null,
    mobilePaymentUrl: officialPaymentUrl,
    paymentUrl: officialPaymentUrl,
    cancellationRequested,
    // An expired QR is not evidence that the provider failed to collect payment.
    qrExpired: order.provider === "alipay" && order.status === "pending" && expired,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
