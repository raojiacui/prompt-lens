import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ pageExec: vi.fn((_method: string, _httpMethod: string, _options: Record<string, unknown>) => "payment-form") }));
vi.mock("alipay-sdk", () => ({ AlipaySdk: class { pageExec = sdk.pageExec; } }));
import { createAlipayPaymentForm } from "@/lib/payments/alipay";

describe("payment form gateway deadline", () => {
  afterEach(() => { vi.unstubAllEnvs(); sdk.pageExec.mockClear(); });
  it("passes an absolute deadline, so reopening checkout cannot reset the clock", () => {
    vi.stubEnv("ALIPAY_APP_ID", "test-app");
    vi.stubEnv("ALIPAY_PRIVATE_KEY", "mock-private-key");
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "mock-public-key");
    createAlipayPaymentForm({ outTradeNo: "test-order", amountCents: 2190, subject: "Test", returnUrl: "http://localhost/return", expiresAt: new Date("2026-10-01T07:15:00Z") });
    expect(sdk.pageExec).toHaveBeenCalledWith("alipay.trade.page.pay", "POST", expect.objectContaining({ bizContent: expect.objectContaining({ time_expire: "2026-10-01 15:15:00", out_trade_no: "test-order", total_amount: "21.90" }) }));
  });
  it("requests the official embedded QR without redirecting the parent on completion", () => {
    vi.stubEnv("ALIPAY_APP_ID", "test-app");
    vi.stubEnv("ALIPAY_PRIVATE_KEY", "mock-private-key");
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "mock-public-key");
    createAlipayPaymentForm({ outTradeNo: "test-order", amountCents: 2190, subject: "Test", returnUrl: "http://localhost/return", embedded: true, expiresAt: new Date("2026-10-01T07:15:00Z") });
    const options = sdk.pageExec.mock.calls[0]?.[2];
    expect(options).toEqual(expect.objectContaining({ bizContent: expect.objectContaining({ qr_pay_mode: "4", qrcode_width: "224", time_expire: "2026-10-01 15:15:00" }) }));
    expect(options).not.toHaveProperty("returnUrl");
  });
});
