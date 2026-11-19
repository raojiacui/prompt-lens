import { NextResponse } from "next/server";
import { verifyWaffoPaymentWebhook, waffoPaymentConfig } from "@/lib/payments/waffo-client";
import { applyWaffoEvent } from "@/lib/payments/waffo-events";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { waffoPaymentConfig(); } catch { return NextResponse.json({ code: "WAFFO_NOT_ACTIVE" }, { status: 503 }); }
  const body = await request.text();
  if (Buffer.byteLength(body) > 100_000) return new Response("Payload too large", { status: 413 });
  let event;
  try { event = verifyWaffoPaymentWebhook(body, request.headers.get("x-waffo-signature")); }
  catch { return new Response("Invalid webhook", { status: 401 }); }
  try {
    const result = await applyWaffoEvent(event);
    return NextResponse.json({ accepted: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ code: "WAFFO_EVENT_UNCONFIRMED" }, { status: 503 });
  }
}
