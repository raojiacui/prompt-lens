import { afterEach, expect, it, vi } from "vitest";
import { assertWaffoCheckoutUrl, waffoAvailablePackages, waffoPaymentConfig } from "@/lib/payments/waffo-client";
import { paymentMinorUnits } from "@/lib/payments/currencies";
afterEach(() => vi.unstubAllEnvs());
it("requires an explicit environment, project and enable flag", () => {
  vi.stubEnv("WAFFO_PAYMENTS_ENABLED", "false");
  expect(waffoAvailablePackages()).toEqual([]);
  vi.stubEnv("WAFFO_PAYMENTS_ENABLED", "true");
  vi.stubEnv("WAFFO_PAYMENT_ENVIRONMENT", "prod");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI");
  expect(() => waffoPaymentConfig()).toThrow("WAFFO_PAYMENTS_DISABLED");
});
it("parses financial values without float rounding or coercion", () => {
  expect(paymentMinorUnits("34.90", "CNY")).toBe(3490);
  expect(paymentMinorUnits("199", "CNY")).toBe(19900);
  for (const value of ["34.901", "-1", "1e2", 34.9, "NaN"]) expect(() => paymentMinorUnits(value, "CNY")).toThrow();
});
it("enables production packages only in the live production project with production product IDs", () => {
  vi.stubEnv("WAFFO_PAYMENTS_ENABLED", "true");
  vi.stubEnv("WAFFO_PAYMENT_ENVIRONMENT", "prod");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("WAFFO_STORE_ID", "STO_fixture");
  vi.stubEnv("WAFFO_MERCHANT_ID", "MER_fixture");
  vi.stubEnv("WAFFO_PRIVATE_KEY", "fixture");
  vi.stubEnv("WAFFO_PROD_PRODUCT_V6_TRIAL_200", "PROD_trial");
  vi.stubEnv("WAFFO_PROD_PRODUCT_V6_CREATOR_650", "PROD_creator");
  vi.stubEnv("WAFFO_PROD_PRODUCT_V6_VOLUME_1500", "PROD_volume");
  expect(waffoPaymentConfig()).toEqual({ environment: "prod", storeId: "STO_fixture" });
  expect(waffoAvailablePackages()).toEqual(["v6_trial_200", "v6_creator_650", "v6_volume_1500"]);
  vi.stubEnv("VERCEL_ENV", "preview");
  expect(waffoAvailablePackages()).toEqual([]);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("WAFFO_PAYMENTS_ENABLED", "false");
  expect(waffoAvailablePackages()).toEqual([]);
});
it("rejects checkout redirects outside the official HTTPS origin", () => {
  expect(assertWaffoCheckoutUrl("https://pancake.waffo.ai/store/test/checkout/CHK_x#token=x")).toContain("pancake.waffo.ai");
  for (const url of ["http://pancake.waffo.ai/x", "https://pancake.waffo.ai.evil.example/x", "https://user:pass@pancake.waffo.ai/x"]) expect(() => assertWaffoCheckoutUrl(url)).toThrow();
});
