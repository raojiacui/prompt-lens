import { createVerify, createPublicKey } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Sandbox-only receiver: verifies callbacks; deliberately does NOT grant credits.
 * Real purchases must not be enabled until database migrations, idempotent
 * fulfillment, refund handling, and payment amount reconciliation are tested.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_PROJECT_ID !== "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI" || process.env.WAFFO_SANDBOX_CHECKOUT_ENABLED !== "true") {
    return NextResponse.json({ code: "WAFFO_NOT_ACTIVE" }, { status: 503 });
  }
  const publicKey = process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY?.replace(/\\n/g, "\n");
  if (!publicKey) return NextResponse.json({ code: "WEBHOOK_VERIFICATION_UNAVAILABLE" }, { status: 503 });
  const sig = request.headers.get("x-waffo-signature") || "";
  const parts = Object.fromEntries(sig.split(",").map(x => x.trim().split(/=(.*)/s, 2)).filter(x => x.length === 2));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[A-Za-z0-9+/]+={0,2}$/.test(v1)) return new Response("Invalid signature", { status: 401 });
  const drift = Date.now() - Number(t);
  if (!Number.isFinite(drift) || drift > 45 * 60_000 || drift < -60_000) return new Response("Stale signature", { status: 401 });
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return new Response("Payload too large", { status: 413 });
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(t + "." + rawBody);
    if (!verifier.verify(createPublicKey(publicKey), v1, "base64")) return new Response("Invalid signature", { status: 401 });
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }
  let event: { id?: unknown; mode?: unknown; eventType?: unknown; storeId?: unknown };
  try { event = JSON.parse(rawBody); } catch { return new Response("Invalid payload", { status: 400 }); }
  if (event.mode !== "test" || typeof event.id !== "string" || typeof event.eventType !== "string") {
    return new Response("Invalid event environment", { status: 400 });
  }
  // No financial state mutation: this endpoint is only for signed sandbox delivery tests.
  return NextResponse.json({ accepted: true, fulfilled: false }, { headers: { "Cache-Control": "no-store" } });
}
