import { createHash, createPrivateKey, createSign } from "node:crypto";

// Server-only Pancake transport. Merchant keys must never be used in the browser.
// Signature format follows Waffo Pancake's published RSA-SHA256 request contract.
type Envelope<T> = { data?: T | null; errors?: { message?: string }[] };
function credentials() {
  const merchantId = process.env.WAFFO_MERCHANT_ID;
  const key = process.env.WAFFO_PRIVATE_KEY;
  if (!merchantId || !key) throw new Error("WAFFO_NOT_CONFIGURED");
  return { merchantId, key: createPrivateKey(key.replace(/\\n/g, "\n").trim()) };
}
async function signedPost<T>(path: string, data: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const { merchantId, key } = credentials();
  const body = JSON.stringify(data);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonical = ["POST", path, timestamp, createHash("sha256").update(body).digest("base64")].join("\n");
  const signer = createSign("sha256");
  signer.update(canonical);
  const signature = signer.sign(key, "base64");
  let response: Response;
  try {
    response = await fetch("https://api.waffo.ai" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Merchant-Id": merchantId,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body,
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
  } catch {
    throw new Error("WAFFO_NETWORK_UNAVAILABLE");
  }
  const result = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !result?.data || result.errors?.length) throw new Error("WAFFO_GATEWAY_REJECTED");
  return result.data;
}
export async function createWaffoSandboxCheckout(input: {
  productId: string; currency: "CNY"; amountCents: number; buyerIdentity: string; buyerEmail: string; externalOrderId: string;
}) {
  if (process.env.WAFFO_SANDBOX_CHECKOUT_ENABLED !== "true" || process.env.VERCEL_PROJECT_ID !== "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI") {
    throw new Error("WAFFO_SANDBOX_DISABLED");
  }
  if (!/^PROD_[A-Za-z0-9]+$/.test(input.productId) || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || !input.buyerIdentity || !input.buyerEmail || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.externalOrderId)) throw new Error("WAFFO_INVALID_CHECKOUT");
  const [token, session] = await Promise.all([
    signedPost<{ token: string }>("/v1/actions/auth/issue-session-token", { productId: input.productId, buyerIdentity: input.buyerIdentity }),
    signedPost<{ sessionId: string; checkoutUrl: string }>("/v1/actions/checkout/create-session", {
      productId: input.productId,
      buyerEmail: input.buyerEmail,
      currency: input.currency,
      priceSnapshot: { amount: (input.amountCents / 100).toFixed(2), taxCategory: "saas" },
      orderMerchantExternalId: input.externalOrderId,
      withTrial: false,
    }, input.externalOrderId),
  ]);
  const url = new URL(session.checkoutUrl);
  if (url.protocol !== "https:" || url.hostname !== "pancake.waffo.ai" || !token.token || !session.sessionId) {
    throw new Error("WAFFO_INVALID_RESPONSE");
  }
  url.hash = "token=" + encodeURIComponent(token.token);
  return { checkoutUrl: url.toString(), sessionId: session.sessionId };
}
