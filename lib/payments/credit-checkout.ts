import crypto from "crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { creditLedger, db, paymentOrders, userCredits } from "@/lib/db";
import { getCreditPackage, type CreditPackage } from "@/lib/billing/credit-packages";
import { grantCommercialPurchase } from "@/lib/billing/commercial-wallet";
import { COMMERCIAL_PACKAGES, PRICING_VERSION } from "@/lib/billing/pricing-v6";
import { alipayConfig, assertAlipayOrderMatch, assertAlipayQueryMatch } from "./alipay";

export type PaymentProvider = "creem" | "alipay" | "manual_qr";
export type ManualPaymentMethod = "wechat" | "alipay";

function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function randomId(prefix: string, maxLength = 32) {
  const value = `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
  return value.slice(0, maxLength);
}

function envNameForPackage(prefix: string, packageId: string) {
  return `${prefix}_${packageId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function packageAmountCents(pkg: CreditPackage) {
  return Math.round(pkg.priceCny * 100);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function createCreemCreditCheckout(userId: string, packageId: string) {
  const pkg = getCreditPackage(packageId);
  if (!pkg) throw new Error("积分包不存在");
  const apiKey = process.env.CREEM_API_KEY;
  if (!apiKey) throw new Error("银行卡支付尚未配置 CREEM_API_KEY");
  const productId = process.env[envNameForPackage("CREEM_PRODUCT", packageId)];
  if (!productId) throw new Error(`银行卡支付尚未配置 ${envNameForPackage("CREEM_PRODUCT", packageId)}`);

  const baseUrl = (process.env.CREEM_API_BASE_URL || (process.env.CREEM_TEST_MODE === "true" ? "https://test-api.creem.io" : "https://api.creem.io")).replace(/\/$/, "");
  const successUrl = `${siteUrl()}/dashboard?payment=success&provider=creem&package=${encodeURIComponent(packageId)}`;
  const response = await fetch(`${baseUrl}/v1/checkouts`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: productId,
      success_url: successUrl,
      metadata: { userId, packageId, credits: String(pkg.credits), packageName: pkg.name },
    }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload?.checkout_url || !payload?.id) {
    throw new Error(String(payload?.message || payload?.error || `Creem checkout failed with ${response.status}`));
  }

  await db.insert(paymentOrders).values({
    userId,
    provider: "creem",
    providerOrderId: String(payload.id),
    checkoutId: String(payload.id),
    packageId: pkg.id,
    packageName: pkg.name,
    credits: pkg.credits,
    amountCents: packageAmountCents(pkg),
    currency: "cny",
    status: "pending",
    checkoutUrl: String(payload.checkout_url),
    rawPayload: payload,
    metadata: { productId },
  }).onConflictDoNothing({ target: [paymentOrders.provider, paymentOrders.providerOrderId] });

  return { url: String(payload.checkout_url), provider: "creem" as const };
}

export async function createAlipayCreditCheckout(userId: string, packageId: string, requestId: string) {
  const commercial = COMMERCIAL_PACKAGES.find((item) => item.id === packageId);
  if (!commercial || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("Invalid commercial checkout request");
  }
  const { appId } = alipayConfig();
  const providerOrderId = `ali_${crypto.createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 28)}`;
  const [created] = await db.insert(paymentOrders).values({
    userId,
    provider: "alipay",
    providerOrderId,
    packageId: commercial.id,
    packageName: commercial.name,
    credits: commercial.credits,
    amountCents: commercial.priceCents,
    currency: "cny",
    status: "pending",
    metadata: { method: "alipay", appId, pricingVersion: PRICING_VERSION, rewrites: commercial.rewrites },
  }).onConflictDoNothing({ target: [paymentOrders.provider, paymentOrders.providerOrderId] }).returning();
  const order = created || await db.query.paymentOrders.findFirst({
    where: and(eq(paymentOrders.provider, "alipay"), eq(paymentOrders.providerOrderId, providerOrderId), eq(paymentOrders.userId, userId)),
  });
  if (!order || order.packageId !== packageId) throw new Error("Checkout request replay mismatch");
  return {
    provider: "alipay" as const,
    orderId: order.id,
    status: order.status,
    paymentUrl: `/api/payments/orders/${order.id}/pay`,
    expiresAt: new Date(order.createdAt.getTime() + 30 * 60 * 1000).toISOString(),
  };
}

export async function createManualCreditPayment(userId: string, packageId: string, method: ManualPaymentMethod, input: { paymentReference?: string; contact?: string; note?: string } = {}) {
  const pkg = getCreditPackage(packageId);
  if (!pkg) throw new Error("积分包不存在");
  const providerOrderId = randomId(method === "wechat" ? "manual_wx" : "manual_ali", 48);
  const amountCents = packageAmountCents(pkg);
  const metadata = {
    method,
    paymentReference: input.paymentReference || null,
    contact: input.contact || null,
    note: input.note || null,
    source: "pricing_manual_payment",
  };

  const [order] = await db.insert(paymentOrders).values({
    userId,
    provider: "manual_qr",
    providerOrderId,
    packageId: pkg.id,
    packageName: pkg.name,
    credits: pkg.credits,
    amountCents,
    currency: "cny",
    status: "pending",
    rawPayload: metadata,
    metadata,
  }).returning();

  return {
    orderId: order.providerOrderId,
    provider: "manual_qr" as const,
    status: order.status,
    packageName: order.packageName,
    credits: order.credits,
    amountCents: order.amountCents,
  };
}
export async function settlePaidCreditOrder(input: {
  provider: PaymentProvider;
  lookupOrderId: string;
  finalOrderId?: string;
  checkoutId?: string | null;
  rawPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  verifiedAlipayQuery?: boolean;
}) {
  const finalOrderId = input.finalOrderId || input.lookupOrderId;
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentOrders).where(or(
        and(eq(paymentOrders.provider, input.provider), eq(paymentOrders.providerOrderId, input.lookupOrderId)),
        input.checkoutId ? and(eq(paymentOrders.provider, input.provider), eq(paymentOrders.checkoutId, input.checkoutId)) : undefined,
      )).for("update");
    if (!order) throw new Error(`Payment order not found: ${input.provider}/${input.lookupOrderId}`);

    if (input.provider === "alipay") {
      if (input.verifiedAlipayQuery) assertAlipayQueryMatch(order, input.rawPayload || {});
      else assertAlipayOrderMatch(order, input.rawPayload || {});
    }
    if (order.status === "paid") return { order, granted: false };
    if (order.status !== "pending") throw new Error(`Payment order cannot be settled from ${order.status}`);

    if (order.packageId.startsWith("v6_")) {
      const snapshot = asObject(order.metadata);
      if (snapshot.pricingVersion !== PRICING_VERSION || !Number.isSafeInteger(snapshot.rewrites) || Number(snapshot.rewrites) < 0) {
        throw new Error("Missing commercial purchase snapshot");
      }
      if (input.provider !== "alipay" || snapshot.method !== "alipay") throw new Error("Commercial purchases require Alipay");
      const granted = await grantCommercialPurchase(tx, {
        userId: order.userId, orderId: order.id, packageId: order.packageId,
        credits: order.credits, rewrites: Number(snapshot.rewrites),
      });
      const [updatedOrder] = await tx.update(paymentOrders).set({
        status: "paid", paidAt: new Date(), updatedAt: new Date(),
        rawPayload: input.rawPayload || order.rawPayload,
        metadata: { ...snapshot, ...(input.metadata || {}), wallet: "commercial_v6" },
      }).where(eq(paymentOrders.id, order.id)).returning();
      return { order: updatedOrder, granted };
    }

    const paymentReference = finalOrderId;
    const existingLedger = await tx.query.creditLedger.findFirst({
      where: and(eq(creditLedger.paymentProvider, input.provider), eq(creditLedger.paymentReference, paymentReference)),
    });

    const nextMetadata = { ...asObject(order.metadata), ...(input.metadata || {}), ...(existingLedger ? { creditLedgerId: existingLedger.id } : {}) };
    const [updatedOrder] = await tx.update(paymentOrders).set({
      providerOrderId: finalOrderId,
      checkoutId: input.checkoutId || order.checkoutId,
      status: "paid",
      rawPayload: input.rawPayload || order.rawPayload,
      metadata: nextMetadata,
      paidAt: order.paidAt || new Date(),
      updatedAt: new Date(),
    }).where(eq(paymentOrders.id, order.id)).returning();

    if (existingLedger) return { order: updatedOrder, granted: false };

    const [balanceRow] = await tx.insert(userCredits).values({
      userId: order.userId,
      balance: order.credits,
      lifetimeGranted: order.credits,
      metadata: { packageId: order.packageId, paymentProvider: input.provider },
    }).onConflictDoUpdate({
      target: userCredits.userId,
      set: {
        balance: sql`${userCredits.balance} + ${order.credits}`,
        lifetimeGranted: sql`${userCredits.lifetimeGranted} + ${order.credits}`,
        metadata: sql`${userCredits.metadata} || ${JSON.stringify({ packageId: order.packageId, paymentProvider: input.provider })}::jsonb`,
        updatedAt: new Date(),
      },
    }).returning();

    const [ledger] = await tx.insert(creditLedger).values({
      userId: order.userId,
      amount: order.credits,
      balanceAfter: balanceRow.balance,
      type: "payment_grant",
      packageId: order.packageId,
      paymentProvider: input.provider,
      paymentReference,
      note: `支付购买 ${order.packageName}`,
      metadata: { orderId: order.id, amountCents: order.amountCents, currency: order.currency, ...(input.metadata || {}) },
    }).returning();

    await tx.update(paymentOrders).set({ metadata: { ...nextMetadata, creditLedgerId: ledger.id }, updatedAt: new Date() }).where(eq(paymentOrders.id, order.id));
    return { order: updatedOrder, granted: true };
  });
}
