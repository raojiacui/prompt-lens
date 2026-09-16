import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders } from "@/lib/db";
import { getXunhuPaySecretForApp, settlePaidCreditOrder } from "./credit-checkout";
import { createXunhuPayHash, verifyXunhuPayHash } from "./xunhupay-signature";

export function paymentObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Only scalar fields have a documented signature encoding. Never trust unsigned nested data. */
export function authenticatedGatewayPayload(raw: unknown, secret: string) {
  const body = paymentObject(raw);
  if (Object.values(body).every((v) => v === null || typeof v !== "object") && verifyXunhuPayHash(body, secret)) {
    if (typeof body.data === "string") return { ...body, ...paymentObject(JSON.parse(body.data)) };
    return body;
  }
  const data = paymentObject(body.data);
  if (Object.values(data).every((v) => v === null || typeof v !== "object") && verifyXunhuPayHash(data, secret)) return data;
  throw new Error("GATEWAY_RESPONSE_SIGNATURE_UNVERIFIED");
}

export async function xunhuRequest(action: "query" | "refund", appId: string, fields: Record<string, unknown>) {
  const secret = getXunhuPaySecretForApp(appId);
  if (!secret) throw new Error("PAYMENT_CHANNEL_NOT_CONFIGURED");
  const payload = { appid: appId, ...fields, time: Math.floor(Date.now() / 1000), nonce_str: crypto.randomBytes(12).toString("hex") };
  const endpoint = process.env[action === "query" ? "XUNHUPAY_QUERY_GATEWAY" : "XUNHUPAY_REFUND_GATEWAY"] || `https://api.xunhupay.com/payment/${action}.html`;
  if (new URL(endpoint).protocol !== "https:") throw new Error("PAYMENT_GATEWAY_REQUIRES_HTTPS");
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, hash: createXunhuPayHash(payload, secret) }), signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
  const raw = await response.json();
  const data = authenticatedGatewayPayload(raw, secret);
  if (data.errcode !== undefined && Number(data.errcode) !== 0) throw new Error("PAYMENT_GATEWAY_REJECTED");
  return data;
}

export async function reconcilePaymentOrder(id: string, userId?: string) {
  const order = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.id, id), userId ? eq(paymentOrders.userId, userId) : undefined) });
  if (!order || order.provider !== "xunhupay" || order.status !== "pending") return;
  const age = Date.now() - order.createdAt.getTime();
  // The published query contract limits active polling to ten minutes. Late notifications still settle.
  if (age > 600000) {
    await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ reconciliation: age >= 86400000 ? "manual_review" : "awaiting_notification" })}::jsonb` }).where(and(eq(paymentOrders.id, id), eq(paymentOrders.status, "pending")));
    return;
  }
  const token = crypto.randomUUID();
  const [claimed] = await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ queryLease: token, queryAfter: Date.now() + 15000 })}::jsonb` })
    .where(and(eq(paymentOrders.id, id), eq(paymentOrders.status, "pending"), sql`COALESCE((${paymentOrders.metadata}->>'queryAfter')::bigint, 0) < ${Date.now()}`)).returning();
  if (!claimed) return;
  let reconciliation = "awaiting_notification";
  try {
    const data = await xunhuRequest("query", String(paymentObject(order.metadata).appId || ""), { out_trade_order: order.providerOrderId });
    const returnedOrder = data.trade_order_id ?? data.out_trade_order;
    if (returnedOrder !== order.providerOrderId) throw new Error("PAYMENT_ORDER_MISMATCH");
    if (data.status === "OD") {
      // Require app and amount in authenticated response; never substitute local values.
      await settlePaidCreditOrder({ provider: "xunhupay", lookupOrderId: order.providerOrderId, rawPayload: data, metadata: { reconciledBy: "query" } });
      reconciliation = "confirmed";
    } else if (data.status === "WP") reconciliation = "awaiting_payment";
    else reconciliation = "manual_review";
  } catch {
    reconciliation = "query_unconfirmed";
  }
  await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ reconciliation, lastQueryAt: new Date().toISOString() })}::jsonb` }).where(and(eq(paymentOrders.id, id), sql`${paymentOrders.metadata}->>'queryLease' = ${token}`));
}
