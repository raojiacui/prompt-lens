import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders } from "@/lib/db";
import { assertAlipayQueryMatch, queryAlipayTrade } from "./alipay";
import { settlePaidCreditOrder } from "./credit-checkout";

function value(result: Record<string, unknown>, snake: string, camel: string) {
  return result[snake] ?? result[camel];
}

export function normalizeAlipayTradeResult(result: Record<string, unknown>) {
  return {
    app_id: value(result, "app_id", "appId"),
    out_trade_no: value(result, "out_trade_no", "outTradeNo"),
    trade_no: value(result, "trade_no", "tradeNo"),
    trade_status: value(result, "trade_status", "tradeStatus"),
    total_amount: value(result, "total_amount", "totalAmount"),
    seller_id: value(result, "seller_id", "sellerId"),
  };
}

export async function reconcileAlipayOrder(id: string, userId?: string) {
  const order = await db.query.paymentOrders.findFirst({
    where: and(eq(paymentOrders.id, id), userId ? eq(paymentOrders.userId, userId) : undefined),
  });
  if (!order || order.provider !== "alipay" || order.status !== "pending") return;

  const token = crypto.randomUUID();
  const [claimed] = await db.update(paymentOrders).set({
    metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ queryLease: token, queryAfter: Date.now() + 15000 })}::jsonb`,
  }).where(and(
    eq(paymentOrders.id, id),
    eq(paymentOrders.status, "pending"),
    sql`COALESCE((${paymentOrders.metadata}->>'queryAfter')::bigint, 0) < ${Date.now()}`,
  )).returning();
  if (!claimed) return;

  let reconciliation = "query_unconfirmed";
  try {
    const result = await queryAlipayTrade(order.providerOrderId) as Record<string, unknown>;
    const payload = normalizeAlipayTradeResult(result);
    if (String(result.code) === "10000") {
      assertAlipayQueryMatch(order, payload);
      if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(String(payload.trade_status))) {
        await settlePaidCreditOrder({
          provider: "alipay",
          lookupOrderId: order.providerOrderId,
          finalOrderId: String(payload.trade_no || order.providerOrderId),
          rawPayload: payload,
          metadata: { reconciledBy: "alipay.trade.query" },
          verifiedAlipayQuery: true,
        });
        reconciliation = "confirmed";
      } else if (payload.trade_status === "WAIT_BUYER_PAY") {
        reconciliation = "awaiting_payment";
      } else if (payload.trade_status === "TRADE_CLOSED") {
        reconciliation = "closed";
        await db.update(paymentOrders).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(paymentOrders.id, id), eq(paymentOrders.status, "pending")));
      }
    } else if (String(result.subCode || result.sub_code) === "ACQ.TRADE_NOT_EXIST") {
      reconciliation = "awaiting_payment";
    }
  } catch {
    reconciliation = "query_unconfirmed";
  }

  await db.update(paymentOrders).set({
    metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ reconciliation, lastQueryAt: new Date().toISOString() })}::jsonb`,
    updatedAt: new Date(),
  }).where(and(eq(paymentOrders.id, id), sql`${paymentOrders.metadata}->>'queryLease' = ${token}`));
}
