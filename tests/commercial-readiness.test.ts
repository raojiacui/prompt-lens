import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commercialAcceptanceAllowed, commercialSalesReady } from "@/lib/billing/commercial-sales";
import { PRICING_VERSION } from "@/lib/billing/pricing-v6";

const accepted = {
  XUNHUPAY_ALIPAY_APP_ID: "test-app", XUNHUPAY_ALIPAY_APP_SECRET: "test-secret",
  KIE_API_KEY: "test-only", FFMPEG_WORKER_URL: "https://worker.example.com", FFMPEG_WORKER_SECRET: "test-only",
  CRON_SECRET: "test-only", COMMERCIAL_SCHEDULER_ACCEPTED: "true", NEXT_PUBLIC_SITE_URL: "https://example.com",
  COMMERCIAL_CONSUMPTION_ENABLED: "true", COMMERCIAL_REWRITE_ENABLED: "true",
  COMMERCIAL_MIGRATION_ACCEPTED: "0012", COMMERCIAL_PAYMENT_ACCEPTANCE: PRICING_VERSION,
  COMMERCIAL_MODEL_ACCEPTANCE: PRICING_VERSION, COMMERCIAL_SALES_ENABLED: "true",
};
describe("Commercial launch guard", () => {
  beforeEach(() => { for (const [key, value] of Object.entries(accepted)) vi.stubEnv(key, value); });
  afterEach(() => vi.unstubAllEnvs());
  it("requires all acceptance markers", () => { expect(commercialSalesReady()).toBe(true); });
  it.each(["COMMERCIAL_SCHEDULER_ACCEPTED", "COMMERCIAL_CONSUMPTION_ENABLED", "COMMERCIAL_REWRITE_ENABLED", "COMMERCIAL_MIGRATION_ACCEPTED", "COMMERCIAL_PAYMENT_ACCEPTANCE", "COMMERCIAL_MODEL_ACCEPTANCE", "COMMERCIAL_SALES_ENABLED", "CRON_SECRET"]) ("fails closed without %s", (key) => {
    vi.stubEnv(key, ""); expect(commercialSalesReady()).toBe(false);
  });
  it.each(["http://example.com", "https://localhost", "not-a-url"])("rejects callback origin %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", url); expect(commercialSalesReady()).toBe(false);
  });
  it("acceptance mode cannot open public sales or bypass infrastructure requirements", () => {
    vi.stubEnv("COMMERCIAL_SALES_ENABLED", "false"); vi.stubEnv("COMMERCIAL_PAYMENT_ACCEPTANCE", ""); vi.stubEnv("COMMERCIAL_MODEL_ACCEPTANCE", "");
    vi.stubEnv("COMMERCIAL_ACCEPTANCE_ENABLED", "true"); vi.stubEnv("COMMERCIAL_ACCEPTANCE_USER_IDS", "owner");
    expect(commercialSalesReady()).toBe(false); expect(commercialAcceptanceAllowed("owner")).toBe(true);
    expect(commercialAcceptanceAllowed("other")).toBe(false);
    vi.stubEnv("COMMERCIAL_MIGRATION_ACCEPTED", ""); expect(commercialAcceptanceAllowed("owner")).toBe(false);
  });
});
