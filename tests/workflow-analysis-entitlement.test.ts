import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ownKey: false, legacyPaid: true, used: 2 }));
vi.mock("@/lib/auth", () => ({ isAdmin: async () => false }));
vi.mock("@/lib/billing/credits", () => ({
  getCreditBalance: async () => ({ balance: 20 }),
  assertHasCredits: vi.fn(), creditErrorResponse: vi.fn(), deductCreditsFromUser: vi.fn(),
}));
vi.mock("@/lib/billing/platform-access", () => ({
  getPlatformKieApiKey: () => "platform-test",
  hasPaidPackageAccess: async () => mocks.legacyPaid,
  resolveKieApiKeyForFeature: async () => ({ hasUserKieKey: mocks.ownKey, apiKey: mocks.ownKey ? "own-test" : "platform-test" }),
}));
vi.mock("@/lib/usage/trial-quota", () => ({
  getUserTrialUsage: async () => ({ limit: 2, used: mocks.used, remaining: 2 - mocks.used, isAdmin: false }),
  assertTrialQuota: vi.fn(), trialQuotaResponse: vi.fn(),
}));

import { getWorkflowAnalysisEntitlement } from "@/lib/billing/video-analysis";

describe("workflow analysis entitlement", () => {
  afterEach(() => { vi.unstubAllEnvs(); mocks.ownKey = false; mocks.legacyPaid = true; mocks.used = 2; });
  it("ignores old package credits when the commercial wallet is active", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const entitlement = await getWorkflowAnalysisEntitlement("user");
    expect(entitlement).toMatchObject({ mode: "trial", hasPaidVideoAnalysis: false, canUsePlatformKie: false });
    expect(entitlement.capabilities.videoAnalysis.canUseLongVideo).toBe(false);
  });
  it("uses the user's KIE key regardless of trial balance", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    mocks.ownKey = true;
    expect((await getWorkflowAnalysisEntitlement("user")).mode).toBe("byok");
  });
  it("preserves legacy entitlement when the new wallet is disabled", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    expect((await getWorkflowAnalysisEntitlement("user")).mode).toBe("platform_credits");
  });
});
