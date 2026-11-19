import { readFileSync } from "node:fs";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { WebhookEvent, WebhookEventData } from "@waffo/pancake-ts";

const state = vi.hoisted(() => ({ db: null as unknown, create: vi.fn(), query: vi.fn(), refund: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return state.db; } }));
vi.mock("@/lib/payments/waffo-client", async original => ({
  ...await original<typeof import("@/lib/payments/waffo-client")>(),
  waffoClient: () => ({ checkout: { authenticated: { create: state.create } }, graphql: { query: state.query }, auth: { issueSessionToken: state.token }, customer: () => ({ createRefundTicket: state.refund }) }),
}));
import { createWaffoOrder } from "@/lib/payments/waffo-orders";
import { applyWaffoEvent } from "@/lib/payments/waffo-events";
import { reconcileWaffoOrder } from "@/lib/payments/waffo-reconciliation";
import { POST as webhook } from "@/app/api/payments/waffo/webhook/route";
import { requestCommercialRefund, reviewCommercialRefund, reconcileCommercialRefund } from "@/lib/payments/commercial-refunds";

const client = new PGlite();
const database = drizzle(client, { schema });
state.db = database;
const userId = randomUUID();
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
beforeAll(async () => {
  await client.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of readFileSync(`drizzle/${entry.tag}.sql`, "utf8").split("--> statement-breakpoint")) await client.exec(statement);
  await client.exec(`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('${userId}','Test','test@example.com',true,now(),now());`);
}, 30_000);
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("WAFFO_PAYMENTS_ENABLED", "true"); vi.stubEnv("WAFFO_PAYMENT_ENVIRONMENT", "test");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI");
  vi.stubEnv("WAFFO_STORE_ID", "STO_test"); vi.stubEnv("WAFFO_MERCHANT_ID", "MER_test"); vi.stubEnv("WAFFO_PRIVATE_KEY", "fixture");
  vi.stubEnv("WAFFO_TEST_PRODUCT_V6_TRIAL_200", "PROD_test"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example.com");
  vi.stubEnv("WAFFO_WEBHOOK_TEST_PUBLIC_KEY", keys.publicKey.export({ type: "spki", format: "pem" }).toString());
  await client.exec("TRUNCATE payment_orders,commercial_wallets,commercial_ledger CASCADE;");
  state.create.mockResolvedValue({ sessionId: "CHK_test", checkoutUrl: "https://pancake.waffo.ai/test#token=secret", expiresAt: new Date(Date.now() + 86400000).toISOString() });
  state.token.mockResolvedValue({ token: "customer-secret" });
  state.refund.mockImplementation(async params => ({ ticket: { id: "TKT_test", subjectId: "PAY_test", status: "pending", refundTicketMerchantExternalId: params.refundTicketMerchantExternalId } }));
});
afterAll(async () => { vi.unstubAllEnvs(); await client.close(); });
async function order() {
  const result = await createWaffoOrder(userId, "test@example.com", "v6_trial_200", randomUUID());
  return (await database.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, result.orderId)))[0];
}
function event(order: typeof schema.paymentOrders.$inferSelect, type = "order.completed"): WebhookEvent<WebhookEventData> {
  return { id: randomUUID(), eventId: randomUUID(), timestamp: new Date().toISOString(), eventType: type, storeId: "STO_test", storeName: "Test", mode: "test", data: {
    orderId: "ORD_test", orderStatus: "completed", buyerEmail: "test@example.com", currency: "CNY", productName: "Test",
    merchantProvidedBuyerIdentity: userId, orderMerchantExternalId: order.providerOrderId,
    orderMetadata: { localOrderId: order.id, productId: "PROD_test", packageId: order.packageId, storeId: "STO_test" },
    paymentId: "PAY_test", paymentStatus: "succeeded", chargedAmount: "38.39", amount: "38.39", taxAmount: "3.49",
    listPrice: { subtotal: "34.90", taxAmount: "3.49", total: "38.39" },
    originalPayment: { subtotal: "34.90", taxAmount: "3.49", total: "38.39" }, refundStatus: "succeeded", refundedAmount: "38.39",
  } } as WebhookEvent<WebhookEventData>;
}
async function deliver(value: WebhookEvent<WebhookEventData>, signed = true) {
  const body = JSON.stringify(value), timestamp = Date.now().toString();
  const signature = sign("RSA-SHA256", Buffer.from(`${timestamp}.${body}`), keys.privateKey).toString("base64");
  return webhook(new Request("https://test.example.com/api/payments/waffo/webhook", { method: "POST", body, headers: { "x-waffo-signature": `t=${timestamp},v1=${signed ? signature : "invalid"}` } }));
}
it("persists server-owned price before checkout, reuses requests, and excludes customer tokens from storage", async () => {
  const requestId = randomUUID();
  state.create.mockRejectedValueOnce(Error("timeout"));
  await expect(createWaffoOrder(userId, "test@example.com", "v6_trial_200", requestId)).rejects.toThrow();
  expect(await database.select().from(schema.paymentOrders)).toHaveLength(1);
  await createWaffoOrder(userId, "test@example.com", "v6_trial_200", requestId);
  const [saved] = await database.select().from(schema.paymentOrders);
  expect(saved.checkoutUrl).not.toContain("secret");
  expect(state.create.mock.calls[1][0]).toMatchObject({ buyerIdentity: userId, priceSnapshot: { amount: "34.90" } });
  expect(state.create.mock.calls[0][1]).toEqual(state.create.mock.calls[1][1]);
});
it("grants exactly once for signed duplicates and separate delivery IDs", async () => {
  const saved = await order(), paid = event(saved);
  expect((await deliver(paid)).status).toBe(200);
  expect((await deliver(paid)).status).toBe(200);
  expect((await deliver({ ...paid, id: randomUUID() })).status).toBe(200);
  expect((await database.select().from(schema.commercialWallets))[0]).toMatchObject({ credits: 200, rewrites: 20 });
  expect(await database.select().from(schema.commercialLedger)).toHaveLength(1);
  expect(await database.select().from(schema.commercialLots)).toHaveLength(1);
});
it.each(["signature", "store", "mode", "user", "product", "currency", "amount", "missingCharged"])("rejects %s mismatches without granting", async kind => {
  const paid = event(await order());
  if (kind === "store") paid.storeId = "STO_other";
  if (kind === "mode") paid.mode = "prod";
  if (kind === "user") paid.data.merchantProvidedBuyerIdentity = randomUUID();
  if (kind === "product") paid.data.orderMetadata!.productId = "PROD_other";
  if (kind === "currency") paid.data.currency = "USD";
  if (kind === "amount") paid.data.chargedAmount = "0.01";
  if (kind === "missingCharged") delete paid.data.chargedAmount;
  expect((await deliver(paid, kind !== "signature")).status).toBeGreaterThanOrEqual(400);
  expect(await database.select().from(schema.commercialWallets)).toHaveLength(0);
  expect(await database.select().from(schema.waffoPaymentEvents)).toHaveLength(0);
});
it("rolls back the order, wallet and event when fulfillment cannot commit", async () => {
  const saved = await order();
  await client.exec("ALTER TABLE commercial_ledger ADD CONSTRAINT reject_purchase CHECK (credits < 0);");
  try { await expect(applyWaffoEvent(event(saved))).rejects.toThrow(); }
  finally { await client.exec("ALTER TABLE commercial_ledger DROP CONSTRAINT reject_purchase;"); }
  expect((await database.select().from(schema.paymentOrders))[0].status).toBe("pending");
  expect(await database.select().from(schema.commercialWallets)).toHaveLength(0);
  expect(await database.select().from(schema.waffoPaymentEvents)).toHaveLength(0);
});
it("accepts a full refund before completion and prevents late credits", async () => {
  const saved = await order();
  await applyWaffoEvent(event(saved, "refund.succeeded"));
  await applyWaffoEvent(event(saved));
  expect((await database.select().from(schema.paymentOrders))[0].status).toBe("refunded");
  expect(await database.select().from(schema.commercialWallets)).toHaveLength(0);
});
it("revokes unused external refunds once and freezes ambiguous partial refunds", async () => {
  const saved = await order();
  await applyWaffoEvent(event(saved));
  const partial = event(saved, "refund.succeeded"); partial.data.refundedAmount = "1.00";
  await applyWaffoEvent(partial);
  expect((await database.select().from(schema.commercialWallets))[0].frozen).toBe(true);
  await applyWaffoEvent(event(saved, "refund.succeeded"));
  await applyWaffoEvent(event(saved, "refund.succeeded"));
  expect((await database.select().from(schema.commercialWallets))[0]).toMatchObject({ credits: 0, rewrites: 0, frozen: true });
});
it("recovers a missed callback from provider evidence and throttles repeated queries", async () => {
  const saved = await order();
  state.query.mockResolvedValue({ data: { webhookDeliveries: [{ payload: event(saved) }] } });
  await reconcileWaffoOrder(saved.id, randomUUID());
  expect(state.query).not.toHaveBeenCalled();
  await reconcileWaffoOrder(saved.id, userId);
  await reconcileWaffoOrder(saved.id, userId);
  expect(state.query).toHaveBeenCalledTimes(1);
  expect((await database.select().from(schema.paymentOrders))[0].status).toBe("paid");
});
it("holds an unused refund, submits one ticket on approval, and waits for actual execution", async () => {
  const saved = await order(); await applyWaffoEvent(event(saved));
  const refund = await requestCommercialRefund(userId, saved.id, "不再需要");
  expect((await database.select().from(schema.commercialWallets))[0].credits).toBe(0);
  const approved = await reviewCommercialRefund("admin", refund.id, "approve", "已核查未使用");
  expect(approved.state).toBe("processing");
  expect(state.refund).toHaveBeenCalledTimes(1);
  expect(state.refund.mock.calls[0][0]).toMatchObject({ requestedAmount: { currency: "CNY", amount: "38.39" } });
  expect((await database.select().from(schema.paymentOrders))[0].status).toBe("paid");
  await expect(reviewCommercialRefund("admin", refund.id, "approve", "重复批准")).rejects.toThrow("REFUND_ALREADY_REVIEWED");
  state.query.mockResolvedValue({ data: { refunds: [{ id: "REF_test", status: "succeeded", orderMerchantExternalId: saved.providerOrderId, refundTicketMerchantExternalId: refund.id, pspAmountDetails: { currency: "CNY", amount: "38.39" } }] } });
  expect((await reconcileCommercialRefund("admin", refund.id)).state).toBe("succeeded");
  expect((await database.select().from(schema.paymentOrders))[0].status).toBe("refunded");
  expect(state.refund).toHaveBeenCalledTimes(1);
});
it("keeps an uncertain refund held and rejects a mismatched recovery amount", async () => {
  const saved = await order(); await applyWaffoEvent(event(saved));
  const refund = await requestCommercialRefund(userId, saved.id, "不再需要");
  state.refund.mockRejectedValueOnce(Error("timeout"));
  expect((await reviewCommercialRefund("admin", refund.id, "approve", "核查完成")).state).toBe("review");
  state.query.mockResolvedValue({ data: { refunds: [{ id: "REF_test", status: "succeeded", orderMerchantExternalId: saved.providerOrderId, refundTicketMerchantExternalId: refund.id, pspAmountDetails: { currency: "CNY", amount: "1.00" } }] } });
  expect((await reconcileCommercialRefund("admin", refund.id)).state).toBe("review");
  expect((await database.select().from(schema.commercialWallets))[0].credits).toBe(0);
  expect((await database.select().from(schema.paymentOrders))[0].status).toBe("paid");
  expect(state.refund).toHaveBeenCalledTimes(1);
});
it("restores held entitlements when local review rejects the refund without a provider call", async () => {
  const saved = await order(); await applyWaffoEvent(event(saved));
  const refund = await requestCommercialRefund(userId, saved.id, "不再需要");
  await reviewCommercialRefund("admin", refund.id, "reject", "用户撤销申请");
  expect((await database.select().from(schema.commercialWallets))[0].credits).toBe(200);
  expect(state.refund).not.toHaveBeenCalled();
});
