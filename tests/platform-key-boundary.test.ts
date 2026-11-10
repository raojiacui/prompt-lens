import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ key: null as string | null, failed: false, paid: false }));
vi.mock("@/lib/auth", () => ({ isAdmin: async () => false }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: async () => {
  if (mocks.failed) throw new Error("KEY_DECRYPTION_FAILED");
  return mocks.key ? { provider: "kie", apiKey: mocks.key } : null;
} }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: {
  query: { creditLedger: { findMany: async () => mocks.paid ? [{ amount: 100, packageId: "old-package" }] : [] } },
} }));
import { resolveApiKeyForFeature } from "@/lib/billing/platform-access";

describe("platform key boundary", () => {
  afterEach(() => { mocks.key = null; mocks.failed = false; mocks.paid = false; vi.unstubAllEnvs(); });
  it("does not fall back to the platform for free or previously paid users", async () => {
    vi.stubEnv("KIE_AI_API_KEY", "platform-secret-test");
    for (const paid of [false, true]) {
      mocks.paid = paid;
      expect(await resolveApiKeyForFeature("user")).toMatchObject({ apiKey: null, source: null });
      expect(await resolveApiKeyForFeature("user", { allowPaidPlatformKey: false })).toMatchObject({ apiKey: null });
    }
  });
  it("keeps BYOK failure closed rather than charging the platform", async () => {
    vi.stubEnv("KIE_AI_API_KEY", "platform-secret-test");
    mocks.failed = true; mocks.paid = true;
    await expect(resolveApiKeyForFeature("user", { allowPaidPlatformKey: true })).rejects.toThrow("KEY_DECRYPTION_FAILED");
  });
  it("uses only the user's key when it exists", async () => {
    vi.stubEnv("KIE_AI_API_KEY", "platform-secret-test"); mocks.key = "user-secret-test";
    expect(await resolveApiKeyForFeature("user")).toMatchObject({ apiKey: "user-secret-test", source: "user" });
  });
});
