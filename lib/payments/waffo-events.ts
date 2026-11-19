import { createHash } from "node:crypto";
import type { WebhookEvent, WebhookEventData, WebhookAmountBreakdown } from "@waffo/pancake-ts";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders, waffoPaymentEvents, commercialLots, commercialWallets, commercialLedger, commercialRefunds } from "@/lib/db";
import { grantCommercialPurchase } from "@/lib/billing/commercial-wallet";
import { moneyCents, waffoPaymentConfig } from "./waffo-client";
import { waffoSnapshot, type WaffoOrder } from "./waffo-orders";

function assertAmount(order: WaffoOrder, price: WebhookAmountBreakdown | undefined) {
  if (!price) throw Error("WAFFO_MISSING_PRICE_EVIDENCE");
  const total = moneyCents(price.total), tax = moneyCents(price.taxAmount);
  const subtotal = price.subtotal === undefined ? total - tax : moneyCents(price.subtotal);
  if (subtotal !== order.amountCents || total !== subtotal + tax || tax < 0) throw Error("WAFFO_AMOUNT_MISMATCH");
  return { total, tax };
}
function assertIdentity(order: WaffoOrder, event: WebhookEvent<WebhookEventData>) {
  const snapshot = waffoSnapshot(order), data = event.data;
  if (data.currency !== "CNY" || data.merchantProvidedBuyerIdentity !== order.userId ||
      data.orderMerchantExternalId !== order.providerOrderId || !/^ORD_[a-zA-Z0-9]+$/.test(data.orderId) ||
      (snapshot.providerOrderId && snapshot.providerOrderId !== data.orderId) ||
      data.orderMetadata?.localOrderId !== order.id || data.orderMetadata?.productId !== snapshot.productId ||
      data.orderMetadata?.packageId !== order.packageId || data.orderMetadata?.storeId !== snapshot.storeId) throw Error("WAFFO_ORDER_IDENTITY_MISMATCH");
  return snapshot;
}
/** Only call with an SDK-verified webhook or a server-validated provider query. */
export async function applyWaffoEvent(event: WebhookEvent<WebhookEventData>) {
  const config = waffoPaymentConfig();
  if (event.mode !== config.environment || event.storeId !== config.storeId || typeof event.id !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(event.id)) throw Error("WAFFO_EVENT_SCOPE_MISMATCH");
  if (!["order.completed", "refund.succeeded", "refund.failed"].includes(event.eventType)) return { ignored: true };
  const ref = event.data?.orderMerchantExternalId;
  if (!ref || typeof ref !== "string") throw Error("WAFFO_ORDER_REFERENCE_MISSING");
  const payloadHash = createHash("sha256").update(JSON.stringify({ eventType: event.eventType, eventId: event.eventId, mode: event.mode, storeId: event.storeId, data: event.data })).digest("hex");
  return db.transaction(async tx => {
    const [order] = await tx.select().from(paymentOrders).where(and(eq(paymentOrders.provider, "waffo"), eq(paymentOrders.providerOrderId, ref))).for("update");
    if (!order) throw Error("WAFFO_ORDER_NOT_FOUND");
    const snapshot = assertIdentity(order, event), data = event.data;
    const [previous] = await tx.select().from(waffoPaymentEvents).where(and(eq(waffoPaymentEvents.environment, config.environment), eq(waffoPaymentEvents.storeId, config.storeId), eq(waffoPaymentEvents.eventId, event.id)));
    if (previous) {
      if (previous.payloadHash !== payloadHash || previous.orderId !== order.id) throw Error("WAFFO_EVENT_REPLAY_MISMATCH");
      return { duplicate: true };
    }
    if (event.eventType === "order.completed") {
      if (snapshot.paymentReview) throw Error("WAFFO_PAYMENT_REQUIRES_REVIEW");
      const price = assertAmount(order, data.listPrice);
      if (data.paymentStatus !== "succeeded" || data.orderStatus !== "completed" || !data.paymentId || moneyCents(data.chargedAmount) !== price.total) throw Error("WAFFO_PAYMENT_UNCONFIRMED");
      if (order.status === "pending") {
        await grantCommercialPurchase(tx, { userId: order.userId, orderId: order.id, packageId: order.packageId, credits: order.credits, rewrites: snapshot.rewrites, linkImports: snapshot.linkImports });
        await tx.update(paymentOrders).set({ status: "paid", paidAt: new Date(), updatedAt: new Date(), metadata: { ...snapshot, providerOrderId: data.orderId, paymentId: data.paymentId, paidTotalCents: price.total, paidTaxCents: price.tax, wallet: "commercial_v6" } }).where(eq(paymentOrders.id, order.id));
      } else if (order.status !== "paid" && order.status !== "refunded") throw Error("WAFFO_ORDER_STATE_MISMATCH");
      if (snapshot.paymentId && snapshot.paymentId !== data.paymentId) throw Error("WAFFO_PAYMENT_ID_MISMATCH");
    } else {
      const price = assertAmount(order, data.originalPayment);
      if (!data.paymentId || (snapshot.paymentId && data.paymentId !== snapshot.paymentId)) throw Error("WAFFO_PAYMENT_ID_MISMATCH");
      if (event.eventType === "refund.succeeded") {
        if (data.refundStatus !== "succeeded" || moneyCents(data.refundedAmount) !== price.total) {
          // Partial or ambiguous refunds require manual accounting; do not restore spendable funds.
          await tx.update(commercialWallets).set({ frozen: true, updatedAt: new Date() }).where(eq(commercialWallets.userId, order.userId));
          await tx.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || '{"paymentReview":"partial_refund"}'::jsonb`, updatedAt: new Date() }).where(eq(paymentOrders.id, order.id));
        } else if (order.status !== "refunded") {
          const [wallet] = await tx.select().from(commercialWallets).where(eq(commercialWallets.userId, order.userId)).for("update");
          const [lot] = await tx.select().from(commercialLots).where(eq(commercialLots.orderId, order.id)).for("update");
          if (lot && wallet) {
            const alreadyHeld = lot.state === "refunding";
            const review = Boolean(lot.usedCredits || lot.usedRewrites || lot.heldCredits || lot.heldRewrites);
            if (!alreadyHeld) {
              await tx.update(commercialWallets).set({ credits: wallet.credits - lot.availableCredits, rewrites: wallet.rewrites - lot.availableRewrites, frozen: wallet.frozen || review, updatedAt: new Date() }).where(eq(commercialWallets.userId, order.userId));
              await tx.insert(commercialLedger).values({ userId: order.userId, eventKey: `waffo-refund:${order.id}`, credits: -lot.availableCredits, rewrites: -lot.availableRewrites, metadata: { orderId: order.id, externalRefund: true, review } });
            }
            await tx.update(commercialLots).set({ state: "refunded" }).where(eq(commercialLots.id, lot.id));
          }
          // A refund arriving before payment prevents a late payment event from granting credits.
          await tx.update(paymentOrders).set({ status: "refunded", metadata: { ...snapshot, providerOrderId: data.orderId, paymentId: data.paymentId }, updatedAt: new Date() }).where(eq(paymentOrders.id, order.id));
          await tx.update(commercialRefunds).set({ state: "succeeded", updatedAt: new Date() }).where(eq(commercialRefunds.orderId, order.id));
        }
      } else {
        await tx.update(commercialRefunds).set({ state: "review", updatedAt: new Date() }).where(and(eq(commercialRefunds.orderId, order.id), sql`${commercialRefunds.state} <> 'succeeded'`));
      }
    }
    await tx.insert(waffoPaymentEvents).values({ eventId: event.id, environment: config.environment, storeId: config.storeId, orderId: order.id, eventType: event.eventType, payloadHash });
    return { processed: true };
  });
}
