import { createHash } from "node:crypto";
import { TaxCategory } from "@waffo/pancake-ts";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentOrders } from "@/lib/db";
import { COMMERCIAL_PACKAGES, PRICING_VERSION } from "@/lib/billing/pricing-v6";
import { assertWaffoCheckoutUrl, waffoClient, waffoPaymentConfig, waffoProductId, type WaffoEnvironment } from "./waffo-client";

export type WaffoOrder = typeof paymentOrders.$inferSelect;
export type WaffoSnapshot = {
  method: "waffo"; environment: WaffoEnvironment; storeId: string; productId: string;
  pricingVersion: string; rewrites: number; linkImports: number; buyerEmail: string;
  providerOrderId?: string; paymentId?: string; paidTotalCents?: number; paidTaxCents?: number;
  cancellationRequested?: boolean; checkoutExpiresAt?: string;
  paymentReview?: string;
};
export function waffoSnapshot(order: WaffoOrder): WaffoSnapshot {
  const value = order.metadata as Partial<WaffoSnapshot>;
  const config = waffoPaymentConfig();
  if (order.provider !== "waffo" || value.method !== "waffo" || value.environment !== config.environment || value.storeId !== config.storeId ||
      !value.productId || !/^PROD_[a-zA-Z0-9]+$/.test(value.productId) || value.pricingVersion !== PRICING_VERSION ||
      !Number.isSafeInteger(value.rewrites) || Number(value.rewrites) < 0 || !Number.isSafeInteger(value.linkImports) || Number(value.linkImports) < 0 ||
      !value.buyerEmail || order.currency !== "cny") throw Error("WAFFO_ORDER_SCOPE_MISMATCH");
  return value as WaffoSnapshot;
}
export async function createWaffoOrder(userId: string, email: string, packageId: string, requestId: string) {
  const config = waffoPaymentConfig();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw Error("INVALID_REQUEST_ID");
  const pack = COMMERCIAL_PACKAGES.find(p => p.id === packageId);
  if (!pack) throw Error("UNKNOWN_PACKAGE");
  const productId = waffoProductId(packageId);
  const externalId = "pl_" + config.environment + "_" + createHash("sha256").update(`${userId}:${requestId.toLowerCase()}`).digest("hex").slice(0, 40);
  await db.insert(paymentOrders).values({
    userId, provider: "waffo", providerOrderId: externalId, packageId: pack.id, packageName: pack.name,
    amountCents: pack.priceCents, credits: pack.credits, currency: "cny", status: "pending",
    metadata: { method: "waffo", ...config, productId, buyerEmail: email, pricingVersion: PRICING_VERSION, rewrites: pack.rewrites, linkImports: pack.linkImports },
  }).onConflictDoNothing({ target: [paymentOrders.provider, paymentOrders.providerOrderId] });
  const order = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.provider, "waffo"), eq(paymentOrders.providerOrderId, externalId), eq(paymentOrders.userId, userId)) });
  if (!order || order.packageId !== packageId) throw Error("CHECKOUT_REPLAY_MISMATCH");
  return openWaffoOrder(order);
}
export async function openWaffoOrder(order: WaffoOrder) {
  const snapshot = waffoSnapshot(order);
  if (order.status !== "pending") return { orderId: order.id, status: order.status, checkoutUrl: null };
  if (snapshot.cancellationRequested || Date.now() - order.createdAt.getTime() > 86400_000) throw Error("WAFFO_ORDER_NOT_PAYABLE");
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "");
  if (origin.protocol !== "https:" || origin.username || origin.password) throw Error("INVALID_SITE_URL");
  const result = await waffoClient().checkout.authenticated.create({
    productId: snapshot.productId, currency: "CNY", buyerIdentity: order.userId, buyerEmail: snapshot.buyerEmail,
    priceSnapshot: { amount: (order.amountCents / 100).toFixed(2), taxCategory: TaxCategory.SaaS },
    orderMerchantExternalId: order.providerOrderId, expiresInSeconds: 86400, allowPromotionCodes: false,
    metadata: { localOrderId: order.id, packageId: order.packageId, productId: snapshot.productId, storeId: snapshot.storeId },
    successUrl: `${origin.origin}/billing/payment/return?orderId=${encodeURIComponent(order.id)}`,
  }, { idempotencyKey: order.providerOrderId });
  const url = assertWaffoCheckoutUrl(result.checkoutUrl);
  // Persist session identity but never the short-lived customer token.
  const storedUrl = new URL(url); storedUrl.hash = "";
  await db.update(paymentOrders).set({ checkoutId: result.sessionId, checkoutUrl: storedUrl.toString(),
    metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ checkoutExpiresAt: result.expiresAt })}::jsonb`, updatedAt: new Date(),
  }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "pending")));
  return { orderId: order.id, status: "pending", checkoutUrl: url };
}
