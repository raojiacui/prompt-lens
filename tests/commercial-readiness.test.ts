import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commercialReadiness } from "@/lib/billing/commercial-readiness";
import { PRICING_VERSION } from "@/lib/billing/pricing-v6";

describe("Commercial configuration diagnostics", () => {
  beforeEach(() => {
    const configured = {
      ALIPAY_APP_ID: "test-app", ALIPAY_PRIVATE_KEY: "test-private", ALIPAY_PUBLIC_KEY: "test-public",
      KIE_API_KEY: "test-only", FFMPEG_WORKER_URL: "https://worker.example.com", FFMPEG_WORKER_SECRET: "test-only",
      CRON_SECRET: "test-only", COMMERCIAL_SCHEDULER_ACCEPTED: "true", NEXT_PUBLIC_SITE_URL: "https://example.com",
      COMMERCIAL_CONSUMPTION_ENABLED: "true", COMMERCIAL_REWRITE_ENABLED: "true",
      COMMERCIAL_MIGRATION_ACCEPTED: "0019", COMMERCIAL_PAYMENT_ACCEPTANCE: PRICING_VERSION,
      COMMERCIAL_MODEL_ACCEPTANCE: PRICING_VERSION,
    };
    for (const [key, value] of Object.entries(configured)) vi.stubEnv(key, value);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("reports configuration without credentials or a sales switch", () => {
    expect(Object.values(commercialReadiness()).every(value => value === true)).toBe(true);
    expect(commercialReadiness()).not.toHaveProperty("salesRequested");
  });
  it("reports missing payment configuration", () => {
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "");
    expect(commercialReadiness().alipay).toBe(false);
  });
  it("keeps consumption and migration diagnostics independent", () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_MIGRATION_ACCEPTED", "");
    expect(commercialReadiness()).toMatchObject({ consumption: false, migrationAccepted: false, alipay: true });
  });
  it.each(["http://example.com", "https://localhost", "not-a-url"])("reports invalid callback origin %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", url);
    expect(commercialReadiness().publicHttps).toBe(false);
  });
});
