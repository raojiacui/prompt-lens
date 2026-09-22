import { AlipaySdk } from "alipay-sdk";

const SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
const PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do";

export type AlipayOrderSnapshot = {
  providerOrderId: string;
  amountCents: number;
  currency: string;
  metadata: unknown;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function alipayConfig() {
  const gateway = (process.env.ALIPAY_GATEWAY || (process.env.ALIPAY_SANDBOX === "true" ? SANDBOX_GATEWAY : PRODUCTION_GATEWAY)).trim();
  if (![SANDBOX_GATEWAY, PRODUCTION_GATEWAY].includes(gateway)) throw new Error("Unsupported Alipay gateway");
  return {
    appId: required("ALIPAY_APP_ID"),
    privateKey: required("ALIPAY_PRIVATE_KEY"),
    alipayPublicKey: required("ALIPAY_PUBLIC_KEY"),
    sellerId: process.env.ALIPAY_SELLER_ID?.trim() || "",
    gateway,
  };
}

export function createAlipaySdk() {
  const config = alipayConfig();
  return new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    alipayPublicKey: config.alipayPublicKey,
    gateway: config.gateway,
    signType: "RSA2",
  });
}

export function cny(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error("Invalid payment amount");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function parseCny(value: unknown) {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0")));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function createAlipayPaymentForm(input: {
  outTradeNo: string;
  amountCents: number;
  subject: string;
  returnUrl: string;
  notifyUrl?: string;
}) {
  const options: Record<string, unknown> = {
    returnUrl: input.returnUrl,
    bizContent: {
      out_trade_no: input.outTradeNo,
      total_amount: cny(input.amountCents),
      subject: input.subject,
      product_code: "FAST_INSTANT_TRADE_PAY",
    },
  };
  if (input.notifyUrl) options.notifyUrl = input.notifyUrl;
  return createAlipaySdk().pageExec("alipay.trade.page.pay", "POST", options);
}

export async function queryAlipayTrade(outTradeNo: string) {
  return createAlipaySdk().exec("alipay.trade.query", { bizContent: { out_trade_no: outTradeNo } });
}

export async function closeAlipayTrade(outTradeNo: string) {
  return createAlipaySdk().exec("alipay.trade.close", { bizContent: { out_trade_no: outTradeNo } });
}

export async function refundAlipayTrade(input: { outTradeNo: string; outRequestNo: string; amountCents: number; reason: string }) {
  return createAlipaySdk().exec("alipay.trade.refund", {
    bizContent: {
      out_trade_no: input.outTradeNo,
      out_request_no: input.outRequestNo,
      refund_amount: cny(input.amountCents),
      refund_reason: input.reason,
    },
  });
}

export async function queryAlipayRefund(outTradeNo: string, outRequestNo: string) {
  return createAlipaySdk().exec("alipay.trade.fastpay.refund.query", {
    bizContent: { out_trade_no: outTradeNo, out_request_no: outRequestNo },
  });
}

export function verifyAlipayNotification(payload: Record<string, string>) {
  return createAlipaySdk().checkNotifySignV2(payload);
}

export function assertAlipayOrderMatch(order: AlipayOrderSnapshot, payload: Record<string, unknown>) {
  const config = alipayConfig();
  if (payload.app_id !== config.appId) throw new Error("Alipay app mismatch");
  if (payload.out_trade_no !== order.providerOrderId) throw new Error("Alipay order mismatch");
  if (order.currency !== "cny" || parseCny(payload.total_amount) !== order.amountCents) throw new Error("Alipay amount mismatch");
  if (config.sellerId && payload.seller_id !== config.sellerId) throw new Error("Alipay seller mismatch");
}

export function assertAlipayQueryMatch(order: AlipayOrderSnapshot, payload: Record<string, unknown>) {
  if (payload.out_trade_no !== order.providerOrderId) throw new Error("Alipay order mismatch");
  if (order.currency !== "cny" || parseCny(payload.total_amount) !== order.amountCents) throw new Error("Alipay amount mismatch");
}

export function isAlipayPaid(payload: Record<string, unknown>) {
  const status = payload.trade_status;
  return (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED")
    && !payload.out_biz_no && !payload.gmt_refund && !payload.refund_fee;
}

export function alipayNotifyUrl(siteUrl: string) {
  const explicit = process.env.ALIPAY_NOTIFY_URL?.trim();
  if (explicit) return explicit;
  try {
    const url = new URL(siteUrl);
    if (url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      return `${siteUrl}/api/payments/webhooks/alipay`;
    }
  } catch {
    // Local development intentionally omits notify_url.
  }
  return undefined;
}
