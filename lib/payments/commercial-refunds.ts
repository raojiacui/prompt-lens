import { and, eq } from "drizzle-orm";
import { db, paymentOrders, commercialWallets, commercialLots, commercialRefunds, commercialLedger } from "@/lib/db";
import { parseCny, queryAlipayRefund, refundAlipayTrade } from "./alipay";

// The documented gateway refunds whole orders, not arbitrary partial amounts.
export async function requestCommercialRefund(userId: string, orderId: string, reason: string) {
  if (!reason.trim() || reason.length > 80) throw new Error("INVALID_REFUND_REASON");
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentOrders).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.userId, userId))).for("update");
    if (!order || order.provider !== "alipay" || !order.packageId.startsWith("v6_")) throw new Error("ORDER_NOT_FOUND");
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
    const data = await refundAlipayTrade({ outTradeNo: result.order.providerOrderId, outRequestNo: result.refund.id, amountCents: result.order.amountCents, reason: reason.trim() }) as Record<string, unknown>;
    if (String(data.code) !== "10000" || String(data.outTradeNo ?? data.out_trade_no) !== result.order.providerOrderId || parseCny(data.refundFee ?? data.refund_fee) !== result.order.amountCents) throw new Error("REFUND_RESPONSE_MISMATCH");
    if (String(data.fundChange ?? data.fund_change) === "Y") {
      await finalizeAlipayRefund(result.order.id, result.refund.id, "succeeded", data);
    } else {
      const query = await queryAlipayRefund(result.order.providerOrderId, result.refund.id) as Record<string, unknown>;
      const succeeded = String(query.code) === "10000" && String(query.refundStatus ?? query.refund_status) === "REFUND_SUCCESS";
      await finalizeAlipayRefund(result.order.id, result.refund.id, succeeded ? "succeeded" : "review", query);
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
