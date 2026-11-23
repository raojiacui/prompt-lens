import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), issue: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAdminUserFromHeaders: mocks.admin }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: {} }));
vi.mock("@/lib/admin/entitlement-grants", async original => ({
  ...await original<typeof import("@/lib/admin/entitlement-grants")>(), issueEntitlementGift: mocks.issue, listEntitlementGifts: mocks.list,
}));
import { GET, POST } from "@/app/api/admin/entitlements/route";
const body = { grantId: "e144a924-67dd-43ac-a91b-90787948c915", email: " Friend@Example.com ", packageId: "v6_trial_200", credits: 200, rewrites: 20, linkImports: 12, days: 7, note: "friend" };
const request = (override = {}, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/entitlements", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...override }),
});
describe("admin expiring gifts", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); mocks.list.mockResolvedValue([]); mocks.issue.mockResolvedValue({ created: true }); });
  it("denies ordinary users access to records and issuing", async () => {
    mocks.admin.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/admin/entitlements"))).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests", async () => {
    expect((await POST(request({}, "https://other.test"))).status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("normalizes emails and binds the authenticated administrator", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledWith({ ...body, email: "friend@example.com" }, "admin");
  });
  it.each([{ days: 0 }, { days: 366 }, { credits: -1 }, { rewrites: 0.5 }, { linkImports: 10001 }, { packageId: "unknown" }, { email: "bad" }, { grantId: "bad" }, { actorId: "other" }])("rejects invalid or tampered input %j", async override => {
    expect((await POST(request(override))).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("supports custom link-import-only gifts but rejects an empty gift", async () => {
    expect((await POST(request({ packageId: "custom", credits: 0, rewrites: 0, linkImports: 2 }))).status).toBe(200);
    expect((await POST(request({ packageId: "custom", credits: 0, rewrites: 0, linkImports: 0 }))).status).toBe(400);
  });
  it.each([["GIFT_USER_NOT_FOUND",404],["GIFT_USER_UNAVAILABLE",409],["GIFT_REPLAY_MISMATCH",409]])("reports %s without leaking database internals", async (error,status) => {
    mocks.issue.mockRejectedValue(new Error(String(error)));
    expect((await POST(request())).status).toBe(status);
  });
  it("returns a retryable failure without claiming success", async () => {
    mocks.issue.mockRejectedValue(new Error("database internal secret"));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
  it("serves uncached records to administrators", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/entitlements"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
