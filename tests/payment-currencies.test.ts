import { expect, it } from "vitest";
import { currencyDigits, paymentMinorUnits, paymentDecimal, suggestedPaymentCurrency } from "@/lib/payments/currencies";
import { convertCnyPrice } from "@/lib/payments/waffo-pricing";

it("treats JPY as integer yen and other supported currencies as hundredths", () => {
  expect(paymentMinorUnits("730", "JPY")).toBe(730);
  expect(paymentMinorUnits("730.00", "JPY")).toBe(730);
  expect(paymentMinorUnits("4.87", "USD")).toBe(487);
  expect(paymentDecimal(730, "JPY")).toBe("730");
  expect(paymentDecimal(487, "USD")).toBe("4.87");
  for (const [value, currency] of [["730.01", "JPY"], ["1.001", "USD"], ["1e2", "CNY"], ["-1", "EUR"], ["9999999999", "JPY"]]) expect(() => paymentMinorUnits(value, currency)).toThrow();
  expect(() => currencyDigits("SGD")).toThrow("UNSUPPORTED_PAYMENT_CURRENCY");
});
it("offers supported local currencies and uses USD for other customer regions", () => {
  for (const [country, currency] of [["CN", "CNY"], ["US", "USD"], ["JP", "JPY"], ["HK", "HKD"], ["AT", "EUR"], ["GB", "GBP"], ["SG", "USD"], ["ID", "USD"], ["CA", "USD"], ["TW", "USD"], ["TR", "USD"]]) expect(suggestedPaymentCurrency(country)).toBe(currency);
  expect(suggestedPaymentCurrency(null)).toBe("USD");
});
it("converts the CNY base exactly with half-up rounding including zero-decimal yen", () => {
  expect(convertCnyPrice(3490, "USD", "0.14")).toBe(489);
  expect(convertCnyPrice(3490, "JPY", "21.5")).toBe(750);
  expect(convertCnyPrice(8990, "USD", "0.14")).toBe(1259);
  expect(convertCnyPrice(19900, "CNY", "1")).toBe(19900);
  for (const rate of ["0", "-1", "1e2", "NaN", "99999999999999999999"]) expect(() => convertCnyPrice(3490, "USD", rate)).toThrow();
});
