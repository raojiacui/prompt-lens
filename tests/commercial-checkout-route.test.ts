import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/payments/checkout/route";
import { POST as manualPost } from "@/app/api/payments/manual/route";
import { createAlipayCreditCheckout } from "@/lib/payments/credit-checkout";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/payments/credit-checkout", () => ({ createAlipayCreditCheckout: vi.fn() }));
const body = { provider: "alipay", method: "alipay", packageId: "v6_trial_200", requestId: "11111111-1111-4111-8111-111111111111" };
const call = (override = {}) => POST(new NextRequest("http://localhost/api/payments/checkout", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ ...body, ...override }) }));

describe("Domestic checkout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "owner" } });
    vi.mocked(createAlipayCreditCheckout).mockResolvedValue({ orderId: "order" } as Awaited<ReturnType<typeof createAlipayCreditCheckout>>);
  });
  it("advertises normal checkout without a launch gate", async () => {
    expect(await (await GET()).json()).toEqual({ enabled: true, provider: "alipay", method: "alipay" });
  });
  it.each(["owner", "other-user"])("allows signed-in account %s to purchase", async (id) => {
    getSession.mockResolvedValue({ user: { id } });
    expect((await call()).status).toBe(200);
    expect(createAlipayCreditCheckout).toHaveBeenCalledWith(id, body.packageId, body.requestId);
  });
  it("requires login before creating an order", async () => {
    getSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(createAlipayCreditCheckout).not.toHaveBeenCalled();
  });
  it("rejects invalid packages, payment methods and request IDs", async () => {
    for (const override of [{ provider: "creem" }, { method: "wechat" }, { packageId: "starter_10" }, { requestId: "bad" }]) expect((await call(override)).status).toBe(400);
    expect(createAlipayCreditCheckout).not.toHaveBeenCalled();
  });
  it("uses server package values rather than submitted credit amounts", async () => {
    expect((await call({ credits: 999999, amountCents: 1, rewrites: 999999 })).status).toBe(200);
    expect(createAlipayCreditCheckout).toHaveBeenCalledWith("owner", body.packageId, body.requestId);
  });
  it("reports actual failures and preserves the request ID for retries", async () => {
    vi.mocked(createAlipayCreditCheckout).mockRejectedValueOnce(new Error("Provider unavailable"));
    const response = await call();
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("CHECKOUT_STATUS_UNKNOWN");
    expect((await call()).status).toBe(200);
    expect(createAlipayCreditCheckout).toHaveBeenNthCalledWith(2, "owner", body.packageId, body.requestId);
  });
  it("closes creation of manual orders", async () => { expect((await manualPost()).status).toBe(410); });
  it("rejects cross-origin checkout", async () => {
    const response = await POST(new NextRequest("http://localhost/api/payments/checkout", { method: "POST", headers: { origin: "https://other.example.com" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(403);
    expect(createAlipayCreditCheckout).not.toHaveBeenCalled();
  });
});
