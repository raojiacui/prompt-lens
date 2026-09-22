import { PRICING_VERSION } from "./pricing-v6";

export function commercialReadiness() {
  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  let publicHttps = false;
  try { const url = new URL(site); publicHttps = url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname); } catch { /* Not a valid public callback URL. */ }
  return {
    alipay: Boolean((process.env.XUNHUPAY_ALIPAY_APP_ID || process.env.XUNHUPAY_APP_ID) && (process.env.XUNHUPAY_ALIPAY_APP_SECRET || process.env.XUNHUPAY_APP_SECRET)),
    kie: Boolean(process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY),
    worker: Boolean(process.env.FFMPEG_WORKER_URL && process.env.FFMPEG_WORKER_SECRET),
    reconciliation: Boolean(process.env.CRON_SECRET && process.env.COMMERCIAL_SCHEDULER_ACCEPTED === "true"),
    publicHttps,
    consumption: process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true",
    rewrites: process.env.COMMERCIAL_REWRITE_ENABLED === "true",
    migrationAccepted: process.env.COMMERCIAL_MIGRATION_ACCEPTED === "0014",
    livePaymentAccepted: process.env.COMMERCIAL_PAYMENT_ACCEPTANCE === PRICING_VERSION,
    liveModelAccepted: process.env.COMMERCIAL_MODEL_ACCEPTANCE === PRICING_VERSION,
    salesRequested: process.env.COMMERCIAL_SALES_ENABLED === "true",
  };
}
