import { commercialReadiness } from "./commercial-readiness";
// Acceptance markers are set only after real migration, scheduler, payment/refund and model tests.
export function commercialSalesReady() {
  return Object.values(commercialReadiness()).every(Boolean);
}

// A server-configured allowlist permits real acceptance testing without opening public sales.
export function commercialAcceptanceAllowed(userId: string) {
  if (process.env.COMMERCIAL_ACCEPTANCE_ENABLED !== "true") return false;
  if (!userId) return false;
  if (process.env.COMMERCIAL_LOCAL_CHECKOUT_ENABLED === "true" && process.env.NODE_ENV === "development" && !process.env.VERCEL) {
    try {
      const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "");
      if (["localhost", "127.0.0.1", "[::1]"].includes(site.hostname) && ["http:", "https:"].includes(site.protocol)) {
        const { alipay, migrationAccepted } = commercialReadiness();
        return alipay && migrationAccepted;
      }
    } catch { /* Invalid origins cannot enable local payment testing. */ }
  }
  const users = (process.env.COMMERCIAL_ACCEPTANCE_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!users.includes(userId)) return false;
  if (process.env.ALIPAY_SANDBOX === "true") {
    const { alipay, migrationAccepted } = commercialReadiness();
    return alipay && migrationAccepted;
  }
  const { livePaymentAccepted, liveModelAccepted, salesRequested, ...infrastructure } = commercialReadiness();
  return Object.values(infrastructure).every(Boolean);
}
