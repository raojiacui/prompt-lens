import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: vi.fn(), find: vi.fn(), reconcile: vi.fn(), eq: vi.fn((field: string, value: string) => ({ field, value })),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: state.session } } }));
vi.mock("@/lib/db", () => ({ db: { query: { paymentOrders: { findFirst: state.find } } }, paymentOrders: { id: "id", userId: "userId" } }));
vi.mock("drizzle-orm", () => ({ eq: state.eq, and: (...parts: unknown[]) => parts }));
vi.mock("@/lib/payments/alipay-reconciliation", () => ({ reconcileAlipayOrder: state.reconcile }));
import { GET } from "@/app/api/payments/orders/[id]/route";

const id = "11111111-1111-4111-8111-111111111111";
const request = (query = "") => GET(new NextRequest(`http://localhost/api/payments/orders/${id}${query}`), { params: Promise.resolve({ id }) });
describe("saved payment order snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session.mockResolvedValue({ user: { id: "owner" } });
    state.find.mockResolvedValue({ id, userId: "owner", provider: "alipay", status: "pending", createdAt: new Date(), amountCents: 2190, credits: 200, metadata: { rewrites: 20 } });
    state.reconcile.mockResolvedValue(undefined);
  });
  it("shows the saved order without waiting for Alipay, scoped to its owner", async () => {
    const response = await request("?snapshot=1");
    expect(response.status).toBe(200);
    expect((await response.json()).paymentUrl).toBe(`/api/payments/orders/${id}/pay`);
    expect(state.reconcile).not.toHaveBeenCalled();
    expect(state.eq).toHaveBeenCalledWith("userId", "owner");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("still reconciles on normal status polls", async () => {
    await request();
    expect(state.reconcile).toHaveBeenCalledWith(id, "owner");
  });
  it("does not expose an order without a session", async () => {
    state.session.mockResolvedValue(null);
    expect((await request("?snapshot=1")).status).toBe(401);
    expect(state.find).not.toHaveBeenCalled();
  });
  it("does not expose another user's order", async () => {
    state.find.mockResolvedValue(undefined);
    expect((await request("?snapshot=1")).status).toBe(404);
  });
  it("does not provide a payment link for an expired snapshot", async () => {
    state.find.mockResolvedValue({ id, provider: "alipay", status: "pending", createdAt: new Date(Date.now() - 20 * 60000), metadata: {} });
    expect((await (await request("?snapshot=1")).json()).paymentUrl).toBeNull();
  });
  it("shows completed payments without a payment link or an expiry warning", async () => {
    state.find.mockResolvedValue({ id, provider: "alipay", status: "paid", createdAt: new Date(Date.now() - 20 * 60000), paidAt: new Date(), credits: 200, metadata: { rewrites: 20, queryError: "ALIPAY_SIGNATURE_INVALID" } });
    const body = await (await request()).json();
    expect(body).toMatchObject({ status: "paid", credits: 200, paymentUrl: null, qrExpired: false, paymentIssue: null });
  });
  it("reports pending verification issues without declaring payment failed", async () => {
    state.find.mockResolvedValue({ id, provider: "alipay", status: "pending", createdAt: new Date(), metadata: { queryError: "ALIPAY_SIGNATURE_INVALID" } });
    expect(await (await request()).json()).toMatchObject({ status: "pending", paymentIssue: "ALIPAY_SIGNATURE_INVALID" });
  });
});
