import { and, eq, sql } from "drizzle-orm";
import type { WebhookEvent, WebhookEventData } from "@waffo/pancake-ts";
import { db, commercialRefunds } from "@/lib/db";
import { waffoClient } from "./waffo-client";
import { paymentCurrency, paymentDecimal, paymentMinorUnits } from "./currencies";
import { waffoSnapshot, type WaffoOrder } from "./waffo-orders";
import { applyWaffoEvent } from "./waffo-events";

type Refund = typeof commercialRefunds.$inferSelect;
function refundSnapshot(order: WaffoOrder, refund: Refund) {
  const snapshot = waffoSnapshot(order);
  if (order.status !== "paid" || refund.orderId !== order.id || refund.userId !== order.userId ||
      !["processing", "review"].includes(refund.state) || (refund.evidence as Record<string, unknown>).decision !== "approve" ||
      !snapshot.paymentId || !snapshot.providerOrderId || !Number.isSafeInteger(snapshot.paidTotalCents) ||
      !Number.isSafeInteger(snapshot.paidTaxCents) || snapshot.paidTotalCents !== order.amountCents + snapshot.paidTaxCents!) throw Error("WAFFO_REFUND_REQUIRES_REVIEW");
  return snapshot;
}
/** Submission creates a Waffo review ticket. Only confirmed execution can finalize the local refund. */
export async function submitWaffoRefund(order: WaffoOrder, refund: Refund) {
  const snapshot = refundSnapshot(order, refund), client = waffoClient();
  const { token } = await client.auth.issueSessionToken({ buyerIdentity: order.userId, storeId: snapshot.storeId, productId: snapshot.productId });
  const { ticket } = await client.customer(token, { environment: snapshot.environment }).createRefundTicket({
    paymentId: snapshot.paymentId!, reason: refund.reason,
    requestedAmount: { currency: paymentCurrency(order.currency), amount: paymentDecimal(snapshot.paidTotalCents!, order.currency) },
    refundTicketMerchantExternalId: refund.id,
  }, { idempotencyKey: `waffo-refund-${refund.id}` });
  if (ticket.subjectId !== snapshot.paymentId || ticket.refundTicketMerchantExternalId !== refund.id) throw Error("WAFFO_REFUND_TICKET_MISMATCH");
  // A callback may have finalized while the request was in flight. Never overwrite it.
  await db.update(commercialRefunds).set({ evidence: sql`${commercialRefunds.evidence} || ${JSON.stringify({ waffoTicketId: ticket.id, waffoTicketStatus: ticket.status })}::jsonb`, updatedAt: new Date() }).where(and(eq(commercialRefunds.id, refund.id), eq(commercialRefunds.state, "processing")));
}
/** Read-only recovery after uncertainty; never submits another ticket. */
export async function reconcileWaffoRefund(order: WaffoOrder, refund: Refund) {
  const snapshot = refundSnapshot(order, refund);
  const result = await waffoClient().graphql.query<{
    refunds: { id: string; status: string; orderMerchantExternalId: string; refundTicketMerchantExternalId: string; pspAmountDetails: { currency: string; amount: string } }[];
  }>({
    query: "query ($ref: String!) { refunds(filter: { refundTicketMerchantExternalId: { eq: $ref } }) { id status orderMerchantExternalId refundTicketMerchantExternalId pspAmountDetails { amount currency } } }",
    variables: { ref: refund.id },
  });
  if (result.errors?.length || !Array.isArray(result.data?.refunds)) throw Error("WAFFO_REFUND_QUERY_UNCONFIRMED");
  const succeeded = result.data.refunds.filter(row => row.status === "succeeded");
  if (succeeded.length !== 1) throw Error("WAFFO_REFUND_QUERY_UNCONFIRMED");
  const actual = succeeded[0];
  if (actual.orderMerchantExternalId !== order.providerOrderId || actual.refundTicketMerchantExternalId !== refund.id ||
      actual.pspAmountDetails?.currency !== order.currency.toUpperCase() || paymentMinorUnits(actual.pspAmountDetails.amount, order.currency) !== snapshot.paidTotalCents) throw Error("WAFFO_REFUND_QUERY_MISMATCH");
  const event: WebhookEvent<WebhookEventData> = {
    id: `query-refund:${refund.id}`, eventId: actual.id, timestamp: new Date().toISOString(), eventType: "refund.succeeded",
    storeId: snapshot.storeId, storeName: "", mode: snapshot.environment,
    data: {
      orderId: snapshot.providerOrderId!, buyerEmail: snapshot.buyerEmail, merchantProvidedBuyerIdentity: order.userId,
      orderMerchantExternalId: order.providerOrderId, currency: paymentCurrency(order.currency), productName: order.packageName,
      orderMetadata: { localOrderId: order.id, packageId: order.packageId, productId: snapshot.productId, storeId: snapshot.storeId },
      paymentId: snapshot.paymentId, refundStatus: "succeeded", refundedAmount: actual.pspAmountDetails.amount,
      refundTicketMerchantExternalId: refund.id, amount: actual.pspAmountDetails.amount, taxAmount: paymentDecimal(snapshot.paidTaxCents!, order.currency),
      originalPayment: { subtotal: paymentDecimal(order.amountCents, order.currency), total: paymentDecimal(snapshot.paidTotalCents!, order.currency), taxAmount: paymentDecimal(snapshot.paidTaxCents!, order.currency) },
    },
  };
  await applyWaffoEvent(event);
}
