import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/payments/checkout/route";
import { POST as manualPost } from "@/app/api/payments/manual/route";
import { commercialAcceptanceAllowed, commercialSalesReady } from "@/lib/billing/commercial-sales";
import { createXunhuPayCreditCheckout } from "@/lib/payments/credit-checkout";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "owner" } }) } } }));
vi.mock("@/lib/billing/commercial-sales", () => ({ commercialSalesReady: vi.fn(() => false), commercialAcceptanceAllowed: vi.fn(() => false) }));
vi.mock("@/lib/payments/credit-checkout", () => ({ createXunhuPayCreditCheckout: vi.fn(async () => ({ orderId: "order" })) }));
const body = { provider: "xunhupay", method: "alipay", packageId: "v6_trial_200", requestId: "11111111-1111-4111-8111-111111111111" };
const call = (override = {}) => POST(new NextRequest("http://localhost/api/payments/checkout", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ ...body, ...override }) }));
describe("Domestic checkout route", () => {
  beforeEach(() => { vi.mocked(commercialSalesReady).mockReturnValue(false); vi.mocked(commercialAcceptanceAllowed).mockReturnValue(false); vi.mocked(createXunhuPayCreditCheckout).mockClear(); });
  it("keeps real sales closed", async () => {
    expect((await (await GET(new NextRequest("http://localhost/api/payments/checkout"))).json()).enabled).toBe(false);
    expect((await call()).status).toBe(503);
    expect(createXunhuPayCreditCheckout).not.toHaveBeenCalled();
  });
  it("rejects legacy packages, foreign payment and WeChat", async () => {
    for (const override of [{ provider: "creem" }, { method: "wechat" }, { packageId: "starter_10" }, { requestId: "bad" }]) expect((await call(override)).status).toBe(400);
    expect(createXunhuPayCreditCheckout).not.toHaveBeenCalled();
  });
  it("uses server package values rather than submitted credit amounts", async () => {
    vi.mocked(commercialSalesReady).mockReturnValue(true);
    expect((await call({ credits: 999999, amountCents: 1, rewrites: 999999 })).status).toBe(200);
    expect(createXunhuPayCreditCheckout).toHaveBeenCalledWith("owner", body.packageId, "alipay", body.requestId);
  });
  it("closes creation of manual orders", async () => { expect((await manualPost()).status).toBe(410); });
  it("allows only explicitly enabled acceptance users while public sales are closed", async () => {
    vi.mocked(commercialAcceptanceAllowed).mockImplementation((id) => id === "owner");
    expect((await call()).status).toBe(200);
    expect(commercialAcceptanceAllowed).toHaveBeenCalledWith("owner");
  });
  it("rejects cross-origin checkout before creating an order", async () => {
    const response = await POST(new NextRequest("http://localhost/api/payments/checkout", { method: "POST", headers: { origin: "https://other.example.com" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(403); expect(createXunhuPayCreditCheckout).not.toHaveBeenCalled();
  });
});
