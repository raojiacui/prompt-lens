import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders, commercialWallets, commercialLots, commercialRefunds, commercialLedger, commercialReservations } from "@/lib/db";
import { parseCny, queryAlipayRefund, refundAlipayTrade } from "./alipay";

// The documented gateway refunds whole orders, not arbitrary partial amounts.
export async function requestCommercialRefund(userId: string, orderId: string, reason: string, contact?: string) {
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
    const [importAttempt] = await tx.select().from(commercialReservations).where(and(eq(commercialReservations.userId, userId), sql`${commercialReservations.quote}->>'linkImportOrderId' = ${orderId}`, sql`(${commercialReservations.state} = 'held' OR ${commercialReservations.quote}->>'linkImportDelivered' = 'true')`));
    if (importAttempt) throw new Error("PACKAGE_USED_OR_RESERVED");
    await tx.update(commercialWallets).set({ credits: wallet.credits - lot.availableCredits, rewrites: wallet.rewrites - lot.availableRewrites, updatedAt: new Date() }).where(eq(commercialWallets.userId, userId));
    await tx.update(commercialLots).set({ state: "refunding" }).where(eq(commercialLots.id, lot.id));
    const [refund] = await tx.insert(commercialRefunds).values({ userId, orderId, reason: reason.trim(), state: "requested", evidence: { contact: contact ?? "" } }).returning();
    await tx.insert(commercialLedger).values({ userId, eventKey: `refund-hold:${refund.id}`, credits: -lot.availableCredits, rewrites: -lot.availableRewrites, metadata: { orderId, refundId: refund.id } });
    return { order, refund, created: true };
  });
  return result.refund;
}

/** Only the authenticated admin route may approve a request after customer-service review. */
export async function reviewCommercialRefund(actorId: string, refundId: string, decision: "approve" | "reject", reviewNote: string) {
  if (!actorId || reviewNote.trim().length < 12 || reviewNote.length > 2000) throw new Error("INVALID_REVIEW_EVIDENCE");
  const result = await db.transaction(async (tx) => {
    const found = await tx.query.commercialRefunds.findFirst({ where: eq(commercialRefunds.id, refundId) });
    if (!found) throw new Error("REFUND_NOT_FOUND");
    const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, found.orderId)).for("update");
    const [refund] = await tx.select().from(commercialRefunds).where(eq(commercialRefunds.id, refundId)).for("update");
    if (refund.state !== "requested") throw new Error("REFUND_ALREADY_REVIEWED");
    const [wallet] = await tx.select().from(commercialWallets).where(eq(commercialWallets.userId, refund.userId)).for("update");
    const [lot] = await tx.select().from(commercialLots).where(eq(commercialLots.orderId, refund.orderId)).for("update");
    if (!order || order.status !== "paid" || order.provider !== "alipay" || !wallet || wallet.frozen || !lot || lot.state !== "refunding") throw new Error("REFUND_REQUIRES_REVIEW");
    if (decision === "reject") {
      await tx.update(commercialWallets).set({ credits: wallet.credits + lot.availableCredits, rewrites: wallet.rewrites + lot.availableRewrites, updatedAt: new Date() }).where(eq(commercialWallets.userId, refund.userId));
      await tx.update(commercialLots).set({ state: "active" }).where(eq(commercialLots.id, lot.id));
    }
    const [updated] = await tx.update(commercialRefunds).set({ state: decision === "approve" ? "processing" : "failed", evidence: { ...refund.evidence as Record<string, unknown>, actorId, decision, reviewNote: reviewNote.trim(), reviewedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(commercialRefunds.id, refund.id)).returning();
    await tx.insert(commercialLedger).values({ userId: refund.userId, eventKey: `refund-${decision}:${refund.id}`, credits: decision === "reject" ? lot.availableCredits : 0, rewrites: decision === "reject" ? lot.availableRewrites : 0, metadata: { actorId, refundId, reviewNote: reviewNote.trim() } });
    return { order, refund: updated };
  });
  if (decision === "reject") return result.refund;
  // The request is durable before the irreversible network call. An uncertain submission is never retried automatically.
  try {
    const data = await refundAlipayTrade({ outTradeNo: result.order.providerOrderId, outRequestNo: result.refund.id, amountCents: result.order.amountCents, reason: result.refund.reason }) as Record<string, unknown>;
    if (String(data.code) !== "10000" || String(data.outTradeNo ?? data.out_trade_no) !== result.order.providerOrderId || parseCny(data.refundFee ?? data.refund_fee) !== result.order.amountCents) throw new Error("REFUND_RESPONSE_MISMATCH");
    if (String(data.fundChange ?? data.fund_change) === "Y") {
      await finalizeAlipayRefund(result.order.id, result.refund.id, "succeeded", data);
    } else {
      const query = await queryAlipayRefund(result.order.providerOrderId, result.refund.id) as Record<string, unknown>;
      const succeeded = String(query.code) === "10000" && String(query.refundStatus ?? query.refund_status) === "REFUND_SUCCESS";
      await finalizeAlipayRefund(result.order.id, result.refund.id, succeeded ? "succeeded" : "review", query);
    }
  } catch {
    await db.update(commercialRefunds).set({ state: "review", updatedAt: new Date() }).where(and(eq(commercialRefunds.id, result.refund.id), eq(commercialRefunds.state, "processing")));
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
    await tx.update(commercialRefunds).set({ state, evidence: { ...refund.evidence as Record<string, unknown>, gateway: evidence }, updatedAt: new Date() }).where(eq(commercialRefunds.id, refundId));
  });
}
