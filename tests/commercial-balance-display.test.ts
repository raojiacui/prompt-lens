import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/billing/commercial-wallet", () => ({ refreshCommercialWallet: state.refresh }));
vi.mock("@/lib/billing/rewrite-recovery", () => ({ recoverExpiredCommercialRewrites: vi.fn() }));
import { getCommercialRewriteBalance } from "@/lib/billing/commercial-rewrite";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("purchased balance display", () => {
  it("returns purchased credits without enabling paid features", async () => {
    vi.stubEnv("COMMERCIAL_REWRITE_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    state.refresh.mockResolvedValue({ credits: 200, rewrites: 20, heldCredits: 0, heldRewrites: 0, frozen: false });
    expect(await getCommercialRewriteBalance("owner")).toMatchObject({ enabled: false, credits: 200, rewrites: 20 });
    expect(state.refresh).toHaveBeenCalledWith("owner");
  });
  it("returns zero only when this user's wallet does not exist", async () => {
    vi.stubEnv("COMMERCIAL_REWRITE_ENABLED", "false");
    state.refresh.mockResolvedValue(undefined);
    expect(await getCommercialRewriteBalance("new-user")).toMatchObject({ enabled: false, credits: 0 });
    expect(state.refresh).toHaveBeenCalledWith("new-user");
  });
});
