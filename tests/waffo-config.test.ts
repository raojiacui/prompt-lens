import { afterEach, expect, it, vi } from "vitest";
import { assertWaffoCheckoutUrl, moneyCents, waffoAvailablePackages, waffoPaymentConfig } from "@/lib/payments/waffo-client";
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
  expect(moneyCents("34.90")).toBe(3490);
  expect(moneyCents("199")).toBe(19900);
  for (const value of ["34.901", "-1", "1e2", 34.9, "NaN"]) expect(() => moneyCents(value)).toThrow();
});
it("rejects checkout redirects outside the official HTTPS origin", () => {
  expect(assertWaffoCheckoutUrl("https://pancake.waffo.ai/store/test/checkout/CHK_x#token=x")).toContain("pancake.waffo.ai");
  for (const url of ["http://pancake.waffo.ai/x", "https://pancake.waffo.ai.evil.example/x", "https://user:pass@pancake.waffo.ai/x"]) expect(() => assertWaffoCheckoutUrl(url)).toThrow();
});
