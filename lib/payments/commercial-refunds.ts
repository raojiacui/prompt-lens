import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders, commercialWallets, commercialLots, commercialRefunds, commercialLedger } from "@/lib/db";
import { paymentObject, xunhuRequest } from "./xunhupay-reconciliation";
import { parseCnyCents } from "./xunhupay-signature";
import { parseCny, queryAlipayRefund, refundAlipayTrade } from "./alipay";

// The documented gateway refunds whole orders, not arbitrary partial amounts.
export async function requestCommercialRefund(userId: string, orderId: string, reason: string) {
  if (!reason.trim() || reason.length > 80) throw new Error("INVALID_REFUND_REASON");
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentOrders).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.userId, userId))).for("update");
    if (!order || !["xunhupay", "alipay"].includes(order.provider) || !order.packageId.startsWith("v6_")) throw new Error("ORDER_NOT_FOUND");
    const [existing] = await tx.select().from(commercialRefunds).where(eq(commercialRefunds.orderId, orderId));
    if (existing) return { order, refund: existing, created: false };
    if (order.status !== "paid") throw new Error("ORDER_NOT_PAID");
    const [wallet] = await tx.select().from(commercialWallets).where(eq(commercialWallets.userId, userId)).for("update");
    const [lot] = await tx.select().from(commercialLots).where(eq(commercialLots.orderId, orderId)).for("update");
    if (!wallet || wallet.frozen || !lot || lot.state !== "active") throw new Error("REFUND_REQUIRES_REVIEW");
    if (lot.usedCredits || lot.usedRewrites || lot.heldCredits || lot.heldRewrites) throw new Error("PACKAGE_USED_OR_RESERVED");
    await tx.update(commercialWallets).set({ credits: wallet.credits - lot.availableCredits, rewrites: wallet.rewrites - lot.availableRewrites, updatedAt: new Date() }).where(eq(commercialWallets.userId, userId));
    await tx.update(commercialLots).set({ state: "refunding" }).where(eq(commercialLots.id, lot.id));
    const [refund] = await tx.insert(commercialRefunds).values({ userId, orderId, reason: reason.trim(), state: "requested" }).returning();
    await tx.insert(commercialLedger).values({ userId, eventKey: `refund-hold:${refund.id}`, credits: -lot.availableCredits, rewrites: -lot.availableRewrites, metadata: { orderId, refundId: refund.id } });
    return { order, refund, created: true };
  });
  if (!result.created) return result.refund;
  // The request is durable before the irreversible network call. An uncertain submission is never retried automatically.
  try {
    if (result.order.provider === "alipay") {
      const data = await refundAlipayTrade({ outTradeNo: result.order.providerOrderId, outRequestNo: result.refund.id, amountCents: result.order.amountCents, reason: reason.trim() }) as Record<string, unknown>;
      if (String(data.code) !== "10000" || String(data.outTradeNo ?? data.out_trade_no) !== result.order.providerOrderId || parseCny(data.refundFee ?? data.refund_fee) !== result.order.amountCents) throw new Error("REFUND_RESPONSE_MISMATCH");
      if (String(data.fundChange ?? data.fund_change) === "Y") {
        await finalizeAlipayRefund(result.order.id, result.refund.id, "succeeded", data);
      } else {
        const query = await queryAlipayRefund(result.order.providerOrderId, result.refund.id) as Record<string, unknown>;
        const succeeded = String(query.code) === "10000" && String(query.refundStatus ?? query.refund_status) === "REFUND_SUCCESS";
        await finalizeAlipayRefund(result.order.id, result.refund.id, succeeded ? "succeeded" : "review", query);
      }
    } else {
      const data = await xunhuRequest("refund", String(paymentObject(result.order.metadata).appId || ""), { trade_order_id: result.order.providerOrderId, reason: reason.trim() });
      if (data.trade_order_id !== result.order.providerOrderId || parseCnyCents(data.refund_fee) !== result.order.amountCents) throw new Error("REFUND_RESPONSE_MISMATCH");
      await applyCommercialRefundNotification({ ...data, appid: paymentObject(result.order.metadata).appId, total_fee: data.refund_fee, status: data.refund_status });
    }
  } catch {
    await db.update(commercialRefunds).set({ state: "review", updatedAt: new Date() }).where(and(eq(commercialRefunds.id, result.refund.id), eq(commercialRefunds.state, "requested")));
  }
  return (await db.select().from(commercialRefunds).where(eq(commercialRefunds.id, result.refund.id)))[0];
}

async function finalizeAlipayRefund(orderId: string, refundId: string, state: "succeeded" | "review", evidence: Record<string, unknown>) {
  return db.transaction(async (tx) => {
    const [refund] = await tx.select().from(commercialRefunds).where(and(eq(commercialRefunds.id, refundId), eq(commercialRefunds.orderId, orderId))).for("update");
    if (!refund || refund.state === "succeeded") return;
    const [lot] = await tx.select().from(commercialLots).where(eq(commercialLots.orderId, orderId)).for("update");
    if (state === "succeeded" && lot?.state === "refunding") {
      await tx.update(commercialLots).set({ state: "refunded" }).where(eq(commercialLots.id, lot.id));
      await tx.update(paymentOrders).set({ status: "refunded", updatedAt: new Date() }).where(eq(paymentOrders.id, orderId));
    }
    await tx.update(commercialRefunds).set({ state, evidence, updatedAt: new Date() }).where(eq(commercialRefunds.id, refundId));
  });
}

/** Caller verifies the gateway signature. Callback CD means refunded, unlike query CD. */
export async function applyCommercialRefundNotification(payload: Record<string, unknown>) {
  if (!["CD", "RD", "UD"].includes(String(payload.status))) throw new Error("INVALID_REFUND_STATUS");
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentOrders).where(and(eq(paymentOrders.provider, "xunhupay"), eq(paymentOrders.providerOrderId, String(payload.trade_order_id)))).for("update");
    if (!order || payload.appid !== paymentObject(order.metadata).appId || order.currency !== "cny" || parseCnyCents(payload.total_fee) !== order.amountCents) throw new Error("REFUND_ORDER_MISMATCH");
    const [wallet] = await tx.select().from(commercialWallets).where(eq(commercialWallets.userId, order.userId)).for("update");
    const [lot] = await tx.select().from(commercialLots).where(eq(commercialLots.orderId, order.id)).for("update");
    let [refund] = await tx.select().from(commercialRefunds).where(eq(commercialRefunds.orderId, order.id));
    if (refund?.state === "succeeded") return;
    if (refund?.state === "failed" && payload.status === "UD") return;
    if (!refund) {
      [refund] = await tx.insert(commercialRefunds).values({ userId: order.userId, orderId: order.id, state: "review", reason: "External gateway refund" }).returning();
      // An out-of-band refund needs review; never subtract already-spent funds into a negative wallet.
      if (wallet) await tx.update(commercialWallets).set({ frozen: true }).where(eq(commercialWallets.userId, order.userId));
      if (lot) await tx.update(commercialLots).set({ state: "review" }).where(eq(commercialLots.id, lot.id));
    }
    if (!wallet || !lot || lot.state !== "refunding") {
      if (wallet) await tx.update(commercialWallets).set({ frozen: true }).where(eq(commercialWallets.userId, order.userId));
      if (lot) await tx.update(commercialLots).set({ state: "review" }).where(eq(commercialLots.id, lot.id));
      await tx.update(commercialRefunds).set({ state: "review", evidence: payload, updatedAt: new Date() }).where(eq(commercialRefunds.id, refund.id));
      // Preserve the financial fact, while keeping the wallet blocked until allocation review.
      if (payload.status === "CD") await tx.update(paymentOrders).set({ status: "refunded", updatedAt: new Date() }).where(eq(paymentOrders.id, order.id));
      return;
    }
    const state = payload.status === "CD" ? "succeeded" : payload.status === "UD" ? "failed" : "processing";
    if (state === "succeeded") {
      await tx.update(commercialLots).set({ state: "refunded" }).where(eq(commercialLots.id, lot.id));
      await tx.update(paymentOrders).set({ status: "refunded", updatedAt: new Date() }).where(eq(paymentOrders.id, order.id));
    } else if (state === "failed") {
      await tx.update(commercialLots).set({ state: "active" }).where(eq(commercialLots.id, lot.id));
      await tx.update(commercialWallets).set({ credits: sql`${commercialWallets.credits} + ${lot.availableCredits}`, rewrites: sql`${commercialWallets.rewrites} + ${lot.availableRewrites}`, updatedAt: new Date() }).where(eq(commercialWallets.userId, order.userId));
      await tx.insert(commercialLedger).values({ userId: order.userId, eventKey: `refund-release:${refund.id}`, credits: lot.availableCredits, rewrites: lot.availableRewrites, metadata: { orderId: order.id } }).onConflictDoNothing();
    }
    await tx.update(commercialRefunds).set({ state, evidence: payload, updatedAt: new Date() }).where(eq(commercialRefunds.id, refund.id));
  });
}
