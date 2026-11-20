import type { WebhookEvent, WebhookEventData } from "@waffo/pancake-ts";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders } from "@/lib/db";
import { waffoClient } from "./waffo-client";
import { waffoSnapshot } from "./waffo-orders";
import { applyWaffoEvent } from "./waffo-events";

/** Recover original provider evidence; never synthesize a charged amount from a quoted price. */
export async function reconcileWaffoOrder(id: string, userId?: string) {
  const order = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.id, id), eq(paymentOrders.provider, "waffo"), userId ? eq(paymentOrders.userId, userId) : undefined) });
  if (!order || !["pending", "paid"].includes(order.status)) return;
  const snapshot = waffoSnapshot(order);
  const claimed = await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ queryAfter: Date.now() + 30_000 })}::jsonb` }).where(and(eq(paymentOrders.id, id), sql`COALESCE((${paymentOrders.metadata}->>'queryAfter')::bigint, 0) < ${Date.now()}`)).returning({ id: paymentOrders.id });
  if (!claimed.length) return;
  try {
    const response = await waffoClient().graphql.query<{ webhookDeliveries: { payload: unknown }[] }>({
      query: "query ($storeId: String!) { webhookDeliveries(storeId: $storeId, limit: 50) { payload } }",
      variables: { storeId: snapshot.storeId },
    });
    if (response.errors?.length || !Array.isArray(response.data?.webhookDeliveries)) {
      console.warn("waffo.reconciliation.response_invalid", {
        errors: response.errors?.map(error => ({ message: error.message.slice(0, 350), layer: error.layer })),
        dataKeys: response.data ? Object.keys(response.data) : [],
        deliveriesType: response.data?.webhookDeliveries === null ? "null" : typeof response.data?.webhookDeliveries,
      });
      throw Error("WAFFO_QUERY_UNCONFIRMED");
    }
    for (const delivery of response.data.webhookDeliveries) {
      const event = (typeof delivery.payload === "string" ? JSON.parse(delivery.payload) : delivery.payload) as WebhookEvent<WebhookEventData> | null;
      if (event?.data?.orderMerchantExternalId === order.providerOrderId) await applyWaffoEvent(event);
    }
    await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} - 'queryError'` }).where(eq(paymentOrders.id, id));
  } catch {
    await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || '{"queryError":"WAFFO_QUERY_UNCONFIRMED"}'::jsonb` }).where(eq(paymentOrders.id, id));
  }
}
