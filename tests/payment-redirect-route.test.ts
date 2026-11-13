import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), issue: vi.fn(), paymentUrl: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { query: { paymentOrders: { findFirst: mocks.find } }, update: () => ({ set: () => ({ where: () => ({ returning: mocks.issue }) }) }) } }));
vi.mock("@/lib/payments/alipay", () => ({ alipayNotifyUrl: () => "https://prompt-lens.cc.cd/api/payments/webhooks/alipay", createAlipayPaymentUrl: mocks.paymentUrl }));
vi.mock("@/lib/payments/alipay-reconciliation", () => ({ reconcileAlipayOrder: mocks.reconcile }));
import { GET } from "@/app/api/payments/orders/[id]/pay/route";

const id = "11111111-1111-4111-8111-111111111111";
const call = (embedded = false) => GET(new NextRequest(`https://prompt-lens.cc.cd/api/payments/orders/${id}/pay${embedded ? "?embedded=1" : ""}`), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.find.mockResolvedValue({ id, providerOrderId: "existing-order", userId: "owner", status: "pending", createdAt: new Date(), amountCents: 2190, packageName: "体验包", metadata: {} });
  mocks.issue.mockResolvedValue([{ id }]);
  mocks.paymentUrl.mockReturnValue("https://openapi.alipay.com/gateway.do?isolated=test");
});
it.each([false, true])("redirects the same owned order without an auto-submit form (embedded=%s)", async embedded => {
  const response = await call(embedded);
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("https://openapi.alipay.com/gateway.do?isolated=test");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  expect(await response.text()).toBe("");
  expect(mocks.paymentUrl).toHaveBeenCalledWith(expect.objectContaining({ outTradeNo: "existing-order", amountCents: 2190, embedded, expiresAt: expect.any(Date) }));
});
it("requires a session and an owned order before issuing payment", async () => {
  mocks.session.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(307);
  expect(mocks.find).not.toHaveBeenCalled();
  mocks.find.mockResolvedValueOnce(undefined);
  expect((await call()).status).toBe(404);
  expect(mocks.paymentUrl).not.toHaveBeenCalled();
});
it.each(["paid", "cancelled", "refunded"])("does not reopen a %s order", async status => {
  mocks.find.mockResolvedValueOnce({ ...await mocks.find(), status });
  expect((await call()).headers.get("Location")).toContain("/billing/payment/return");
  expect(mocks.paymentUrl).not.toHaveBeenCalled();
});
it.each(["expired", "cancellationRequested"])("reconciles %s orders without signing a payment", async scenario => {
  const order = await mocks.find();
  mocks.find.mockResolvedValueOnce({ ...order, ...(scenario === "expired" ? { createdAt: new Date(Date.now() - 16 * 60000) } : { metadata: { cancellationRequested: true } }) });
  expect((await call()).headers.get("Location")).toContain("/billing/payment/return");
  expect(mocks.reconcile).toHaveBeenCalledWith(id, "owner");
  expect(mocks.paymentUrl).not.toHaveBeenCalled();
});
it("does not issue payment if the order stops being payable during the guard", async () => {
  mocks.issue.mockResolvedValueOnce([]);
  expect((await call()).headers.get("Location")).toContain("/billing/payment/return");
  expect(mocks.paymentUrl).not.toHaveBeenCalled();
});
