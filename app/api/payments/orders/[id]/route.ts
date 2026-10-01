import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, paymentOrders } from "@/lib/db";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  await reconcileAlipayOrder(id, session.user.id);
  const order = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id)) });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const officialPaymentUrl = order.provider === "alipay" && order.status === "pending" ? `/api/payments/orders/${order.id}/pay` : null;
  return NextResponse.json({
    id: order.id, orderId: order.id, status: order.status, packageName: order.packageName,
    expiresAt: new Date(order.createdAt.getTime() + 30 * 60 * 1000).toISOString(),
    amountCents: order.amountCents, currency: order.currency, credits: order.credits,
    paidAt: order.paidAt,
    qrImageUrl: null,
    mobilePaymentUrl: officialPaymentUrl,
    paymentUrl: officialPaymentUrl,
    // An expired QR is not evidence that the provider failed to collect payment.
    qrExpired: order.provider === "alipay" && Date.now() >= order.createdAt.getTime() + 30 * 60 * 1000,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
