import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commercialAcceptanceAllowed, commercialSalesReady } from "@/lib/billing/commercial-sales";
import { PRICING_VERSION } from "@/lib/billing/pricing-v6";

const accepted = {
  ALIPAY_APP_ID: "test-app", ALIPAY_PRIVATE_KEY: "test-private", ALIPAY_PUBLIC_KEY: "test-public",
  KIE_API_KEY: "test-only", FFMPEG_WORKER_URL: "https://worker.example.com", FFMPEG_WORKER_SECRET: "test-only",
  CRON_SECRET: "test-only", COMMERCIAL_SCHEDULER_ACCEPTED: "true", NEXT_PUBLIC_SITE_URL: "https://example.com",
  COMMERCIAL_CONSUMPTION_ENABLED: "true", COMMERCIAL_REWRITE_ENABLED: "true",
  COMMERCIAL_MIGRATION_ACCEPTED: "0015", COMMERCIAL_PAYMENT_ACCEPTANCE: PRICING_VERSION,
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
  it("allows an explicitly allowlisted user to test sandbox checkout without production infrastructure", () => {
    for (const key of ["KIE_API_KEY", "FFMPEG_WORKER_URL", "FFMPEG_WORKER_SECRET", "CRON_SECRET", "NEXT_PUBLIC_SITE_URL"]) vi.stubEnv(key, "");
    vi.stubEnv("COMMERCIAL_SCHEDULER_ACCEPTED", "false");
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_REWRITE_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_PAYMENT_ACCEPTANCE", "");
    vi.stubEnv("COMMERCIAL_MODEL_ACCEPTANCE", "");
    vi.stubEnv("COMMERCIAL_SALES_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_ACCEPTANCE_ENABLED", "true");
    vi.stubEnv("COMMERCIAL_ACCEPTANCE_USER_IDS", "owner");
    vi.stubEnv("ALIPAY_SANDBOX", "true");

    expect(commercialSalesReady()).toBe(false);
    expect(commercialAcceptanceAllowed("owner")).toBe(true);
    expect(commercialAcceptanceAllowed("other")).toBe(false);
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "");
    expect(commercialAcceptanceAllowed("owner")).toBe(false);
  });
  it("does not use the reduced sandbox readiness checks for a production gateway", () => {
    vi.stubEnv("COMMERCIAL_ACCEPTANCE_ENABLED", "true");
    vi.stubEnv("COMMERCIAL_ACCEPTANCE_USER_IDS", "owner");
    vi.stubEnv("ALIPAY_SANDBOX", "false");
    vi.stubEnv("CRON_SECRET", "");
    expect(commercialAcceptanceAllowed("owner")).toBe(false);
  });
});
