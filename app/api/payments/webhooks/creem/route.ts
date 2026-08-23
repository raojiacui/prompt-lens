import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { settlePaidCreditOrder } from "@/lib/payments/credit-checkout";

function verifySignature(rawBody: string, signature: string, secret: string) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("creem-signature") || "";
  const secret = process.env.CREEM_WEBHOOK_SECRET || "";
  if (!secret) return NextResponse.json({ error: "CREEM_WEBHOOK_SECRET is not configured" }, { status: 500 });
  if (!signature || !verifySignature(rawBody, signature, secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  if (payload.eventType !== "checkout.completed") return NextResponse.json({ received: true });

  const object = payload.object && typeof payload.object === "object" ? payload.object as Record<string, unknown> : {};
  const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata as Record<string, unknown> : {};
  const checkoutId = String(object.id || "");
  const order = object.order && typeof object.order === "object" ? object.order as Record<string, unknown> : {};
  const orderId = String(order.id || checkoutId);
  if (!checkoutId) return NextResponse.json({ error: "Missing checkout id" }, { status: 400 });

  await settlePaidCreditOrder({
    provider: "creem",
    lookupOrderId: checkoutId,
    finalOrderId: orderId,
    checkoutId,
    rawPayload: payload,
    metadata: { creemCheckoutId: checkoutId, creemOrderId: orderId, ...metadata },
  });

  return NextResponse.json({ received: true });
}