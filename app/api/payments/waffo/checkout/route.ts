import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createWaffoOrder, openWaffoOrder } from "@/lib/payments/waffo-orders";
import { and, eq } from "drizzle-orm";
import { db, paymentOrders } from "@/lib/db";
import { waffoAvailablePackages } from "@/lib/payments/waffo-client";
import { PAYMENT_CURRENCIES, paymentCurrency, suggestedPaymentCurrency } from "@/lib/payments/currencies";
import { waffoPrices } from "@/lib/payments/waffo-pricing";
import { reconcileWaffoOrder } from "@/lib/payments/waffo-reconciliation";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const packages = waffoAvailablePackages();
  const config = { provider: "waffo", enabled: packages.length > 0, packages, currencies: PAYMENT_CURRENCIES, suggestedCurrency: suggestedPaymentCurrency(request?.headers.get("x-vercel-ip-country") || null) };
  const requestedCurrency = request?.nextUrl.searchParams.get("currency");
  if (!requestedCurrency || !packages.length) return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
  let currency;
  try { currency = paymentCurrency(requestedCurrency); } catch { return NextResponse.json({ code: "UNSUPPORTED_PAYMENT_CURRENCY" }, { status: 400 }); }
  try {
    return NextResponse.json({ ...config, quotes: (await waffoPrices(currency)).filter(price => packages.some(id => id === price.packageId)) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ code: "WAFFO_EXCHANGE_RATE_UNAVAILABLE" }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.checkoutRequestId !== undefined && (typeof body.checkoutRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.checkoutRequestId))) return NextResponse.json({ code: "INVALID_CHECKOUT_REQUEST" }, { status: 400 });
  if (typeof body?.orderId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.orderId)) {
    await reconcileWaffoOrder(body.orderId, session.user.id);
    const order = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.id, body.orderId), eq(paymentOrders.userId, session.user.id), eq(paymentOrders.provider, "waffo")) });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    try { return NextResponse.json(await openWaffoOrder(order, body.checkoutRequestId), { headers: { "Cache-Control": "private, no-store" } }); }
    catch { return NextResponse.json({ code: "CHECKOUT_STATUS_UNKNOWN" }, { status: 502 }); }
  }
  if (typeof body?.packageId !== "string" || typeof body?.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) return NextResponse.json({ code: "INVALID_CHECKOUT_REQUEST" }, { status: 400 });
  if (!waffoAvailablePackages().includes(body.packageId)) return NextResponse.json({ code: "PACKAGE_NOT_OPEN" }, { status: 409 });
  let currency;
  try { currency = paymentCurrency(body.currency ?? "CNY"); } catch { return NextResponse.json({ code: "UNSUPPORTED_PAYMENT_CURRENCY" }, { status: 400 }); }
  try {
    return NextResponse.json(await createWaffoOrder(session.user.id, session.user.email, body.packageId, body.requestId, currency, body.checkoutRequestId), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ code: "CHECKOUT_STATUS_UNKNOWN", error: "无法确认结账状态，请保留本次请求重试或联系支持。" }, { status: 502 });
  }
}
