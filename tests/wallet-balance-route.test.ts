import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), where: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { select: mocks.select } }));
import { GET } from "@/app/api/payments/account/route";

describe("account balance snapshot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "owner" } });
    mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
  });
  it("requires authentication", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/payments/account?balanceOnly=1"))).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("reads only the signed-in wallet and separates credits held for refunds", async () => {
    mocks.where.mockResolvedValueOnce([{ credits: 200, rewrites: 20, heldCredits: 0, heldRewrites: 0, frozen: false }]).mockResolvedValueOnce([{ credits: 300 }]);
    const response = await GET(new NextRequest("http://localhost/api/payments/account?balanceOnly=1&userId=other"));
    expect(await response.json()).toEqual({ wallet: { credits: 200, rewrites: 20, heldCredits: 0, heldRewrites: 0, frozen: false, refundHeldCredits: 300 } });
    const dialect = new PgDialect();
    expect(mocks.where.mock.calls.map(([condition]) => dialect.sqlToQuery(condition).params)).toEqual([["owner"], ["owner", "refunding"]]);
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("returns a real zero for an account without a wallet", async () => {
    mocks.where.mockResolvedValueOnce([]).mockResolvedValueOnce([{ credits: 0 }]);
    const response = await GET(new NextRequest("http://localhost/api/payments/account?balanceOnly=1"));
    expect((await response.json()).wallet.credits).toBe(0);
  });
});
