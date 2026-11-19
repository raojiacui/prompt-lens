export const PAYMENT_CURRENCIES = ["CNY", "USD", "JPY", "HKD", "EUR", "GBP"] as const;
export type PaymentCurrency = typeof PAYMENT_CURRENCIES[number];
export function paymentCurrency(value: unknown): PaymentCurrency {
  if (typeof value !== "string" || !PAYMENT_CURRENCIES.includes(value.toUpperCase() as PaymentCurrency)) throw Error("UNSUPPORTED_PAYMENT_CURRENCY");
  return value.toUpperCase() as PaymentCurrency;
}
export function currencyDigits(currency: string) { return paymentCurrency(currency) === "JPY" ? 0 : 2; }
/** Gateway decimal strings to integer minor units; JPY has no fractional units. */
export function paymentMinorUnits(value: unknown, currency: string) {
  const digits = currencyDigits(currency);
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,8})?$/.test(value)) throw Error("WAFFO_INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(digits))) throw Error("WAFFO_INVALID_AMOUNT");
  const result = Number(whole) * 10 ** digits + Number(fraction.slice(0, digits).padEnd(digits, "0"));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647) throw Error("WAFFO_INVALID_AMOUNT");
  return result;
}
export function paymentDecimal(minor: number, currency: string) {
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > 2_147_483_647) throw Error("WAFFO_INVALID_AMOUNT");
  const digits = currencyDigits(currency), divisor = 10 ** digits;
  return digits ? `${Math.floor(minor / divisor)}.${String(minor % divisor).padStart(digits, "0")}` : String(minor);
}
export function formatPaymentAmount(minor: number, currency = "CNY", locale = "zh-CN") {
  const code = paymentCurrency(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: code === "CNY" ? "narrowSymbol" : "code", minimumFractionDigits: currencyDigits(code), maximumFractionDigits: currencyDigits(code) }).format(minor / 10 ** currencyDigits(code));
}
export function suggestedPaymentCurrency(country: string | null) {
  const region = country?.toUpperCase();
  if (region === "CN") return "CNY" as const;
  if (region === "JP") return "JPY" as const;
  if (region === "HK") return "HKD" as const;
  if (["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"].includes(region || "")) return "EUR" as const;
  if (region === "GB") return "GBP" as const;
  return "USD" as const;
}
