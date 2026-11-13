import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, paymentOrders } from "@/lib/db";
import { alipayNotifyUrl, createAlipayPaymentUrl } from "@/lib/payments/alipay";
import { alipayOrderDeadline } from "@/lib/payments/order-expiry";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";

function siteUrl(request: NextRequest) {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  return (explicit || request.nextUrl.origin).replace(/\/$/, "");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Invalid order", { status: 400 });
  const order = await db.query.paymentOrders.findFirst({
    where: and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id), eq(paymentOrders.provider, "alipay")),
  });
  if (!order) return new NextResponse("Order not found", { status: 404 });
  if (order.status !== "pending") return NextResponse.redirect(new URL(`/billing/payment/return?orderId=${order.id}`, request.url));
  const deadline = alipayOrderDeadline(order.createdAt);
  if (Date.now() >= deadline.getTime() || (order.metadata as Record<string, unknown>).cancellationRequested === true) {
    await reconcileAlipayOrder(order.id, session.user.id);
    return NextResponse.redirect(new URL(`/billing/payment/return?orderId=${order.id}`, request.url));
  }

  const [issued] = await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ paymentFormIssuedAt: new Date().toISOString() })}::jsonb` }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "pending"), sql`COALESCE(${paymentOrders.metadata}->>'cancellationRequested', 'false') != 'true'`)).returning();
  if (!issued) return NextResponse.redirect(new URL(`/billing/payment/return?orderId=${order.id}`, request.url));

  const base = siteUrl(request);
  const embedded = request.nextUrl.searchParams.get("embedded") === "1";
  const paymentUrl = createAlipayPaymentUrl({
    outTradeNo: order.providerOrderId,
    amountCents: order.amountCents,
    subject: `Prompt Lens ${order.packageName}`,
    returnUrl: `${base}/billing/payment/return?orderId=${order.id}`,
    notifyUrl: alipayNotifyUrl(base),
    expiresAt: deadline,
    embedded,
  });
  return new NextResponse(null, {
    status: 303,
    headers: {
      "Location": paymentUrl,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "no-referrer",
    },
  });
}
