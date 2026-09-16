import { NextRequest, NextResponse } from "next/server";
import { getXunhuPaySecretForApp, settlePaidCreditOrder, verifyXunhuPayHash } from "@/lib/payments/credit-checkout";
import { applyCommercialRefundNotification } from "@/lib/payments/commercial-refunds";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const payload = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  const appId = payload.appid || "";
  const secret = getXunhuPaySecretForApp(appId);
  if (!secret || !verifyXunhuPayHash(payload, secret)) return new NextResponse("invalid sign", { status: 400 });

  const status = payload.status;
  const tradeOrderId = payload.trade_order_id;
  if (!tradeOrderId) return new NextResponse("missing order", { status: 400 });
  if (["CD", "RD", "UD"].includes(status)) {
    await applyCommercialRefundNotification(payload);
    return new NextResponse("success");
  }
  if (status !== "OD") return new NextResponse("unsupported status", { status: 400 });

  await settlePaidCreditOrder({
    provider: "xunhupay",
    lookupOrderId: tradeOrderId,
    finalOrderId: tradeOrderId,
    rawPayload: payload,
    metadata: { transactionId: payload.transaction_id, openOrderId: payload.open_order_id, appId },
  });

  return new NextResponse("success");
}
