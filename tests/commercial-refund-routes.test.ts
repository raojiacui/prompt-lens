import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } }, getAdminUserFromHeaders: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: {} }));
vi.mock("@/lib/billing/commercial-wallet", () => ({ settleCommercialTaskInTransaction: vi.fn() }));
vi.mock("@/lib/billing/commercial-readiness", () => ({ commercialReadiness: vi.fn() }));
vi.mock("@/lib/payments/alipay-reconciliation", () => ({ reconcileAlipayOrder: vi.fn() }));
vi.mock("@/lib/payments/commercial-refunds", () => ({ requestCommercialRefund: vi.fn(), updateCommercialRefundRequest: vi.fn(), reviewCommercialRefund: vi.fn(), reconcileCommercialRefund: vi.fn() }));

import { auth, getAdminUserFromHeaders } from "@/lib/auth";
import { requestCommercialRefund, updateCommercialRefundRequest, reviewCommercialRefund, reconcileCommercialRefund } from "@/lib/payments/commercial-refunds";
import { POST as requestRefund, PATCH as updateRefund } from "@/app/api/payments/orders/[id]/refund/route";
import { GET as listReviews, POST as reviewRefund } from "@/app/api/admin/payments/commercial/route";

const id = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id }) };
const body = { action: "approve_refund", refundId: id, customerContacted: true, approveConfirmed: true, evidence: "Contacted customer and verified the order" };
function req(payload: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/refund", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

describe("manual refund route authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "customer" } } as never);
    vi.mocked(getAdminUserFromHeaders).mockResolvedValue({ id: "admin" } as never);
    vi.mocked(requestCommercialRefund).mockResolvedValue({ id, state: "requested" } as never);
    vi.mocked(reviewCommercialRefund).mockResolvedValue({ id, state: "succeeded" } as never);
    vi.mocked(reconcileCommercialRefund).mockResolvedValue({ id, state: "review" } as never);
  });
  it("requires authentication and same-origin for customer requests", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
    expect((await requestRefund(req({ reason: "Unused", contact: "wechat" }), params)).status).toBe(401);
    expect((await requestRefund(req({ reason: "Unused", contact: "wechat" }, "https://other.example"), params)).status).toBe(403);
    expect(requestCommercialRefund).not.toHaveBeenCalled();
  });
  it("requires contact details and submits only a request, never admin approval", async () => {
    expect((await requestRefund(req({ reason: "Unused" }), params)).status).toBe(400);
    const response = await requestRefund(req({ reason: "Unused", contact: " wechat " }), params);
    expect(await response.json()).toEqual({ id, state: "requested" });
    expect(requestCommercialRefund).toHaveBeenCalledWith("customer", id, "Unused", "wechat");
    expect(reviewCommercialRefund).not.toHaveBeenCalled();
  });
  it("blocks non-admins and cross-site admin requests", async () => {
    vi.mocked(getAdminUserFromHeaders).mockResolvedValueOnce(null);
    expect((await reviewRefund(req(body))).status).toBe(403);
    expect((await reviewRefund(req(body, "https://other.example"))).status).toBe(403);
    expect(reviewCommercialRefund).not.toHaveBeenCalled();
  });
  it("protects customer ticket edits and binds them to the authenticated user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
    expect((await updateRefund(req({ reason: "Updated", contact: "wechat" }), params)).status).toBe(401);
    expect((await updateRefund(req({ reason: "Updated", contact: "wechat" }, "https://other.example"), params)).status).toBe(403);
    expect((await updateRefund(req({ reason: " ", contact: "wechat" }), params)).status).toBe(400);
    expect(updateCommercialRefundRequest).not.toHaveBeenCalled();
    vi.mocked(updateCommercialRefundRequest).mockResolvedValue({ id, state: "requested" } as never);
    expect((await updateRefund(req({ reason: "Updated", contact: "wechat" }), params)).status).toBe(200);
    expect(updateCommercialRefundRequest).toHaveBeenCalledWith("customer", id, "Updated", "wechat");
    expect(requestCommercialRefund).not.toHaveBeenCalled();
    expect(reviewCommercialRefund).not.toHaveBeenCalled();
  });
  it("reports ticket ownership and review conflicts without creating another refund", async () => {
    vi.mocked(updateCommercialRefundRequest).mockRejectedValueOnce(new Error("ORDER_NOT_FOUND"));
    expect((await updateRefund(req({ reason: "Updated", contact: "wechat" }), params)).status).toBe(404);
    vi.mocked(updateCommercialRefundRequest).mockRejectedValueOnce(new Error("REFUND_ALREADY_REVIEWED"));
    expect((await updateRefund(req({ reason: "Updated", contact: "wechat" }), params)).status).toBe(409);
    expect(requestCommercialRefund).not.toHaveBeenCalled();
  });
  it("does not expose refund forms or reconciliation records to non-admins", async () => {
    vi.mocked(getAdminUserFromHeaders).mockResolvedValueOnce(null);
    expect((await listReviews(new NextRequest("http://localhost/api/admin/payments/commercial"))).status).toBe(403);
  });
  it("requires customer communication, explicit approval and evidence", async () => {
    for (const missing of [{ customerContacted: false }, { approveConfirmed: false }, { evidence: " " }]) {
      expect((await reviewRefund(req({ ...body, ...missing }))).status).toBe(400);
    }
    expect(reviewCommercialRefund).not.toHaveBeenCalled();
  });
  it("records the authenticated reviewer for approval and rejection", async () => {
    expect((await reviewRefund(req(body))).status).toBe(200);
    expect(reviewCommercialRefund).toHaveBeenCalledWith("admin", id, "approve", body.evidence);
    expect((await reviewRefund(req({ ...body, action: "reject_refund", approveConfirmed: false }))).status).toBe(200);
    expect(reviewCommercialRefund).toHaveBeenLastCalledWith("admin", id, "reject", body.evidence);
  });
  it("accepts a short nonempty customer-service review note", async () => {
    expect((await reviewRefund(req({ ...body, evidence: "可以退款" }))).status).toBe(200);
    expect(reviewCommercialRefund).toHaveBeenCalledWith("admin", id, "approve", "可以退款");
  });
  it("does not retry an uncertain or already reviewed refund", async () => {
    vi.mocked(reviewCommercialRefund).mockRejectedValueOnce(new Error("REFUND_ALREADY_REVIEWED"));
    expect((await reviewRefund(req(body))).status).toBe(409);
    expect(reviewCommercialRefund).toHaveBeenCalledTimes(1);
  });
  it("lets an authenticated admin query without issuing another refund", async () => {
    const response = await reviewRefund(req({ action: "query_refund", refundId: id }));
    expect(await response.json()).toEqual({ id, state: "review" });
    expect(reconcileCommercialRefund).toHaveBeenCalledWith("admin", id);
    expect(reviewCommercialRefund).not.toHaveBeenCalled();
  });
  it("protects refund queries from non-admins, cross-site requests and invalid IDs", async () => {
    vi.mocked(getAdminUserFromHeaders).mockResolvedValueOnce(null);
    expect((await reviewRefund(req({ action: "query_refund", refundId: id }))).status).toBe(403);
    expect((await reviewRefund(req({ action: "query_refund", refundId: id }, "https://other.example"))).status).toBe(403);
    expect((await reviewRefund(req({ action: "query_refund", refundId: "-".repeat(36) }))).status).toBe(400);
    expect(reconcileCommercialRefund).not.toHaveBeenCalled();
  });
  it("does not disguise an ineligible refund as a successful query", async () => {
    vi.mocked(reconcileCommercialRefund).mockRejectedValue(new Error("REFUND_NOT_APPROVED"));
    expect((await reviewRefund(req({ action: "query_refund", refundId: id }))).status).toBe(409);
    expect(reviewCommercialRefund).not.toHaveBeenCalled();
  });
});
