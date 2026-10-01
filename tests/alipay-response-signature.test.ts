import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("alipay-sdk", () => ({ AlipaySdk: class { exec = sdk.exec; } }));
import { closeAlipayTrade, queryAlipayRefund, queryAlipayTrade, refundAlipayTrade } from "@/lib/payments/alipay";

const calls = [
  ["alipay.trade.query", () => queryAlipayTrade("order")],
  ["alipay.trade.close", () => closeAlipayTrade("order")],
  ["alipay.trade.refund", () => refundAlipayTrade({ outTradeNo: "order", outRequestNo: "refund", amountCents: 2190, reason: "Unused" })],
  ["alipay.trade.fastpay.refund.query", () => queryAlipayRefund("order", "refund")],
] as const;

describe("Alipay synchronous response verification", () => {
  beforeEach(() => {
    sdk.exec.mockReset();
    vi.stubEnv("ALIPAY_APP_ID", "test-app");
    vi.stubEnv("ALIPAY_PRIVATE_KEY", "mock-private-key");
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "mock-public-key");
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(calls)("requires SDK signature validation for %s", async (method, call) => {
    sdk.exec.mockResolvedValue({ code: "10000" });
    await call();
    expect(sdk.exec).toHaveBeenCalledWith(method, expect.any(Object), { validateSign: true });
  });
  it.each(calls)("propagates rejected signatures for %s", async (_method, call) => {
    sdk.exec.mockRejectedValue(new Error("invalid response signature"));
    await expect(call()).rejects.toThrow("invalid response signature");
  });
  it("does not allow validation without the provider public key", async () => {
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "");
    await expect(queryAlipayTrade("order")).rejects.toThrow("Missing ALIPAY_PUBLIC_KEY");
    expect(sdk.exec).not.toHaveBeenCalled();
  });
});
