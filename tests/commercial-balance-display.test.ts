import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ where: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/db", () => ({ commercialWallets: { userId: "userId" }, db: { select: () => ({ from: () => ({ where: state.where }) }) } }));
vi.mock("drizzle-orm", () => ({ eq: state.eq }));
import { getCommercialRewriteBalance } from "@/lib/billing/commercial-rewrite";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("purchased balance display", () => {
  it("returns purchased credits without enabling paid features", async () => {
    vi.stubEnv("COMMERCIAL_REWRITE_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    state.where.mockResolvedValue([{ credits: 200, rewrites: 20, heldCredits: 0, heldRewrites: 0, frozen: false }]);
    expect(await getCommercialRewriteBalance("owner")).toMatchObject({ enabled: false, credits: 200, rewrites: 20 });
    expect(state.eq).toHaveBeenCalledWith("userId", "owner");
  });
  it("returns zero only when this user's wallet does not exist", async () => {
    vi.stubEnv("COMMERCIAL_REWRITE_ENABLED", "false");
    state.where.mockResolvedValue([]);
    expect(await getCommercialRewriteBalance("new-user")).toMatchObject({ enabled: false, credits: 0 });
    expect(state.eq).toHaveBeenCalledWith("userId", "new-user");
  });
});
