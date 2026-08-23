import crypto from "crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { creditLedger, db, paymentOrders, userCredits } from "@/lib/db";
import { getCreditPackage, type CreditPackage } from "@/lib/billing/credit-packages";

export type PaymentProvider = "creem" | "xunhupay" | "manual_qr";
export type XunhuPayMethod = "wechat" | "alipay";
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

function createHashPayload(data: Record<string, unknown>, secret: string) {
  const base = Object.keys(data)
    .sort()
    .filter((key) => key !== "hash" && data[key] !== null && data[key] !== undefined && data[key] !== "")
    .map((key) => `${key}=${String(data[key])}`)
    .join("&");
  return crypto.createHash("md5").update(`${base}${secret}`, "utf8").digest("hex");
}

function timingSafeHexEqual(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyXunhuPayHash(data: Record<string, unknown>, secret: string) {
  const received = typeof data.hash === "string" ? data.hash : "";
  if (!received) return false;
  return timingSafeHexEqual(createHashPayload(data, secret), received);
}

function xunhuPayCredentials(method: XunhuPayMethod) {
  const upper = method === "wechat" ? "WECHAT" : "ALIPAY";
  const appId = process.env[`XUNHUPAY_${upper}_APP_ID`] || process.env.XUNHUPAY_APP_ID;
  const appSecret = process.env[`XUNHUPAY_${upper}_APP_SECRET`] || process.env.XUNHUPAY_APP_SECRET;
  if (!appId || !appSecret) throw new Error(`${method === "wechat" ? "微信" : "支付宝"}支付尚未配置 XUNHUPAY_${upper}_APP_ID / XUNHUPAY_${upper}_APP_SECRET`);
  return { appId, appSecret };
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

export async function createXunhuPayCreditCheckout(userId: string, packageId: string, method: XunhuPayMethod) {
  const pkg = getCreditPackage(packageId);
  if (!pkg) throw new Error("积分包不存在");
  const { appId, appSecret } = xunhuPayCredentials(method);
  const tradeOrderId = randomId(method === "wechat" ? "wx" : "ali");
  const gateway = process.env.XUNHUPAY_GATEWAY || "https://api.xunhupay.com/payment/do.html";
  const amountCents = packageAmountCents(pkg);
  const payload: Record<string, unknown> = {
    version: "1.1",
    appid: appId,
    trade_order_id: tradeOrderId,
    total_fee: (amountCents / 100).toFixed(2),
    title: `Prompt Lens ${pkg.name}`,
    time: Math.floor(Date.now() / 1000),
    notify_url: `${siteUrl()}/api/payments/webhooks/xunhupay`,
    return_url: `${siteUrl()}/dashboard?payment=success&provider=xunhupay&package=${encodeURIComponent(packageId)}`,
    callback_url: `${siteUrl()}/#pricing`,
    plugins: "prompt-lens",
    attach: JSON.stringify({ userId, packageId, method }),
    nonce_str: crypto.randomBytes(12).toString("hex"),
  };
  payload.hash = createHashPayload(payload, appSecret);

  const response = await fetch(gateway, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data || Number(data.errcode) !== 0) {
    throw new Error(String(data?.errmsg || `虎皮椒支付创建失败 (${response.status})`));
  }
  const checkoutUrl = String(data.url_qrcode || data.url || "");
  if (!checkoutUrl) throw new Error("虎皮椒支付未返回可用的支付链接");

  await db.insert(paymentOrders).values({
    userId,
    provider: "xunhupay",
    providerOrderId: tradeOrderId,
    packageId: pkg.id,
    packageName: pkg.name,
    credits: pkg.credits,
    amountCents,
    currency: "cny",
    status: "pending",
    checkoutUrl,
    rawPayload: data,
    metadata: { method, appId },
  });

  return { url: checkoutUrl, provider: "xunhupay" as const };
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
}) {
  const finalOrderId = input.finalOrderId || input.lookupOrderId;
  return db.transaction(async (tx) => {
    const order = await tx.query.paymentOrders.findFirst({
      where: or(
        and(eq(paymentOrders.provider, input.provider), eq(paymentOrders.providerOrderId, input.lookupOrderId)),
        input.checkoutId ? and(eq(paymentOrders.provider, input.provider), eq(paymentOrders.checkoutId, input.checkoutId)) : undefined,
      ),
    });
    if (!order) throw new Error(`Payment order not found: ${input.provider}/${input.lookupOrderId}`);

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

export function getXunhuPaySecretForApp(appId: string) {
  if (process.env.XUNHUPAY_WECHAT_APP_ID === appId && process.env.XUNHUPAY_WECHAT_APP_SECRET) return process.env.XUNHUPAY_WECHAT_APP_SECRET;
  if (process.env.XUNHUPAY_ALIPAY_APP_ID === appId && process.env.XUNHUPAY_ALIPAY_APP_SECRET) return process.env.XUNHUPAY_ALIPAY_APP_SECRET;
  if (process.env.XUNHUPAY_APP_ID === appId && process.env.XUNHUPAY_APP_SECRET) return process.env.XUNHUPAY_APP_SECRET;
  return process.env.XUNHUPAY_APP_SECRET || "";
}