import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, paymentOrders } from "@/lib/db";
import { alipayNotifyUrl, createAlipayPaymentForm } from "@/lib/payments/alipay";

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

  const base = siteUrl(request);
  const html = createAlipayPaymentForm({
    outTradeNo: order.providerOrderId,
    amountCents: order.amountCents,
    subject: `Prompt Lens ${order.packageName}`,
    returnUrl: `${base}/billing/payment/return?orderId=${order.id}`,
    notifyUrl: alipayNotifyUrl(base),
  });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action https://openapi.alipay.com https://openapi-sandbox.dl.alipaydev.com",
      "Referrer-Policy": "no-referrer",
    },
  });
}
