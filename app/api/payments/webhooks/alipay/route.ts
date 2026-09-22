import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders } from "@/lib/db";
import { assertAlipayOrderMatch, isAlipayPaid, verifyAlipayNotification } from "@/lib/payments/alipay";
import { settlePaidCreditOrder } from "@/lib/payments/credit-checkout";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const payload = Object.fromEntries(Array.from(form.entries()).map(([key, item]) => [key, String(item)]));
  try {
    if (!verifyAlipayNotification(payload)) return new NextResponse("fail", { status: 400 });
    const outTradeNo = payload.out_trade_no;
    const order = outTradeNo ? await db.query.paymentOrders.findFirst({
      where: and(eq(paymentOrders.provider, "alipay"), eq(paymentOrders.providerOrderId, outTradeNo)),
    }) : null;
    if (!order) return new NextResponse("fail", { status: 404 });
    assertAlipayOrderMatch(order, payload);

    if (isAlipayPaid(payload)) {
      await settlePaidCreditOrder({
        provider: "alipay",
        lookupOrderId: outTradeNo,
        finalOrderId: payload.trade_no || outTradeNo,
        rawPayload: payload,
        metadata: { notifyId: payload.notify_id, settledBy: "alipay-notify" },
      });
    } else {
      await db.update(paymentOrders).set({
        metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ lastNotifyId: payload.notify_id, lastTradeStatus: payload.trade_status })}::jsonb`,
        updatedAt: new Date(),
      }).where(eq(paymentOrders.id, order.id));
    }
    return new NextResponse("success", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch {
    return new NextResponse("fail", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
