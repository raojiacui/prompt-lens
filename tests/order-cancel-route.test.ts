import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), update: vi.fn(), persist: vi.fn(), after: vi.fn(), reconcile: vi.fn() }));
vi.mock("next/server", async () => ({ ...await vi.importActual("next/server"), after: mocks.after }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { query: { paymentOrders: { findFirst: mocks.find } }, update: mocks.update } }));
vi.mock("@/lib/payments/alipay-reconciliation", () => ({ reconcileAlipayOrder: mocks.reconcile }));
import { POST } from "@/app/api/payments/orders/[id]/close/route";
const id = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id }) };
const request = () => new NextRequest(`http://localhost/api/payments/orders/${id}/close`, { method: "POST", headers: { origin: "http://localhost" } });
describe("cancellation acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "owner" } });
    mocks.update.mockReturnValue({ set: () => ({ where: mocks.persist }) });
    mocks.find.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "pending", metadata: { cancellationRequested: true } });
  });
  it("persists cancellation and responds before provider reconciliation", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "pending", cancellationRequested: true });
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.reconcile).toHaveBeenCalledWith(id, "owner", true);
  });
  it("does not acknowledge cancellation when persistence fails", async () => {
    mocks.persist.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await POST(request(), params)).status).toBe(502);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not accept unauthenticated cancellation", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request(), params)).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
