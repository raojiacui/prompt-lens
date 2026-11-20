import { COMMERCIAL_PACKAGES, PRICING_VERSION } from "@/lib/billing/pricing-v6";
import { currencyDigits, paymentCurrency, type PaymentCurrency } from "./currencies";
import { waffoClient, waffoPaymentConfig } from "./waffo-client";

type Rate = { currency: PaymentCurrency; rate: string; rateRefId: string; expiresAt: string };
export type WaffoPrice = Rate & { packageId: string; amountMinor: number; baseCnyCents: number; pricingVersion: string; quotedAt: string };
const rates = new Map<string, Rate>();
const pending = new Map<string, Promise<Rate>>();
/** Decimal arithmetic with half-up rounding; no binary float in monetary calculations. */
export function convertCnyPrice(baseCnyCents: number, currency: PaymentCurrency, rate: string) {
  if (!Number.isSafeInteger(baseCnyCents) || baseCnyCents <= 0 || !/^\d{1,8}(?:\.\d{1,18})?$/.test(rate)) throw Error("WAFFO_INVALID_EXCHANGE_RATE");
  const [whole, fraction = ""] = rate.split(".");
  const numerator = BigInt(whole + fraction);
  if (numerator <= 0n) throw Error("WAFFO_INVALID_EXCHANGE_RATE");
  const denominator = 100n * 10n ** BigInt(fraction.length);
  const amount = (BigInt(baseCnyCents) * numerator * 10n ** BigInt(currencyDigits(currency)) + denominator / 2n) / denominator;
  if (amount <= 0n || amount > 2_147_483_647n) throw Error("WAFFO_INVALID_AMOUNT");
  return Number(amount);
}
async function exchangeRate(currency: PaymentCurrency): Promise<Rate> {
  if (currency === "CNY") return { currency, rate: "1", rateRefId: "base-cny", expiresAt: new Date(Date.now() + 300_000).toISOString() };
  const config = waffoPaymentConfig();
  const key = `${config.environment}:${config.storeId}:${process.env.WAFFO_MERCHANT_ID}:${currency}`;
  const cached = rates.get(key);
  if (cached && Date.parse(cached.expiresAt) > Date.now() + 5000) return cached;
  const running = pending.get(key);
  if (running) return running;
  const query = (async () => {
    const result = await waffoClient().graphql.query<{ rate: { fromCurrency: string; toCurrency: string; standardRate: string | number; rateRefId: string; expiryTime: string } }>({
      query: "query ($from: CurrencyCode!, $to: CurrencyCode!) { rate(fromCurrency: $from, toCurrency: $to) { fromCurrency toCurrency standardRate rateRefId expiryTime } }",
      variables: { from: "CNY", to: currency },
    });
    const value = result.data?.rate;
    if (result.errors?.length || !value || value.fromCurrency !== "CNY" || value.toCurrency !== currency || typeof value.rateRefId !== "string" || !value.rateRefId || !Number.isFinite(Date.parse(value.expiryTime)) || Date.parse(value.expiryTime) <= Date.now() + 5000) {
      // Only rate fields and GraphQL notices: no request headers, keys or customer data.
      console.warn("waffo.exchange_rate.unavailable", { currency,
        errors: result.errors?.map(error => ({ message: error.message.slice(0, 400), layer: error.layer })),
        rate: value ? { from: value.fromCurrency, to: value.toCurrency, value: value.standardRate, referenceType: typeof value.rateRefId, expires: value.expiryTime, expiresType: typeof value.expiryTime } : null,
      });
      throw Error("WAFFO_EXCHANGE_RATE_UNAVAILABLE");
    }
    const rate = String(value.standardRate);
    convertCnyPrice(3490, currency, rate);
    const locked = { currency, rate, rateRefId: value.rateRefId, expiresAt: new Date(Math.min(Date.parse(value.expiryTime), Date.now() + 300_000)).toISOString() };
    rates.set(key, locked);
    return locked;
  })();
  pending.set(key, query);
  try { return await query; }
  catch (error) {
    console.warn("waffo.exchange_rate.request_failed", { currency, code: error instanceof Error ? error.name : "UnknownError", status: error && typeof error === "object" && "status" in error ? error.status : undefined });
    throw error;
  } finally { pending.delete(key); }
}
export async function waffoPrices(value: unknown): Promise<WaffoPrice[]> {
  const currency = paymentCurrency(value), fx = await exchangeRate(currency);
  return COMMERCIAL_PACKAGES.map(pack => ({ ...fx, packageId: pack.id, baseCnyCents: pack.priceCents,
    amountMinor: convertCnyPrice(pack.priceCents, currency, fx.rate), pricingVersion: PRICING_VERSION, quotedAt: new Date().toISOString(),
  }));
}
