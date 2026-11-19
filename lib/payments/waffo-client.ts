import { WaffoPancake, verifyWebhook } from "@waffo/pancake-ts";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";

export type WaffoEnvironment = "test" | "prod";
export function waffoPaymentConfig() {
  const environment = process.env.WAFFO_PAYMENT_ENVIRONMENT;
  const project = process.env.VERCEL_PROJECT_ID;
  const allowed = environment === "test" ? project === "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI"
    : environment === "prod" && project === "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV" && process.env.VERCEL_ENV === "production";
  const storeId = process.env.WAFFO_STORE_ID || "";
  if (process.env.WAFFO_PAYMENTS_ENABLED !== "true" || !allowed || !/^STO_[a-zA-Z0-9]+$/.test(storeId)) throw Error("WAFFO_PAYMENTS_DISABLED");
  if (!process.env.WAFFO_MERCHANT_ID || !process.env.WAFFO_PRIVATE_KEY) throw Error("WAFFO_NOT_CONFIGURED");
  return { environment: environment as WaffoEnvironment, storeId };
}
export function waffoProductId(packageId: string) {
  const { environment } = waffoPaymentConfig();
  if (!COMMERCIAL_PACKAGES.some(p => p.id === packageId)) throw Error("UNKNOWN_PACKAGE");
  const value = process.env[`WAFFO_${environment === "test" ? "TEST" : "PROD"}_PRODUCT_${packageId.toUpperCase()}`];
  if (!value || !/^PROD_[a-zA-Z0-9]+$/.test(value)) throw Error("WAFFO_PRODUCT_NOT_CONFIGURED");
  return value;
}
export function waffoAvailablePackages() {
  try {
    waffoPaymentConfig();
    return COMMERCIAL_PACKAGES.filter(p => { try { waffoProductId(p.id); return true; } catch { return false; } }).map(p => p.id);
  } catch { return []; }
}
export function waffoClient() {
  const { environment } = waffoPaymentConfig();
  return new WaffoPancake({ merchantId: process.env.WAFFO_MERCHANT_ID!, privateKey: process.env.WAFFO_PRIVATE_KEY!, environment,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" }),
  });
}
export function verifyWaffoPaymentWebhook(body: string, signature: string | null) {
  const config = waffoPaymentConfig();
  const event = verifyWebhook(body, signature, { environment: config.environment });
  if (event.mode !== config.environment || event.storeId !== config.storeId) throw Error("WAFFO_EVENT_SCOPE_MISMATCH");
  return event;
}
export function assertWaffoCheckoutUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "pancake.waffo.ai" || url.username || url.password || url.port) throw Error("WAFFO_INVALID_CHECKOUT_URL");
  return url.toString();
}
export function moneyCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) throw Error("WAFFO_INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
