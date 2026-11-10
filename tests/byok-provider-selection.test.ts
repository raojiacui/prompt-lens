import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as { provider: string; apiKey: string; isPreferred?: boolean }[], pinned: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { query: { userApiKeys: { findMany: async () => mocks.rows } } } }));
vi.mock("@/lib/byok/keys", () => ({ decodeStoredApiKey: (value: string) => value === "corrupt" ? null : value, getUserApiKeyForProvider: mocks.pinned }));
import { getUserCredential } from "@/lib/byok/credentials";

beforeEach(() => { mocks.rows = []; mocks.pinned.mockReset(); });
it("preserves KIE for existing users even when Infistar is displayed first", async () => {
  mocks.rows = [{ provider: "infistar", apiKey: "infistar-fixture" }, { provider: "kie", apiKey: "kie-fixture" }];
  expect(await getUserCredential("user")).toEqual({ provider: "kie", apiKey: "kie-fixture" });
});
it("uses Infistar when it is the only configured provider", async () => {
  mocks.rows = [{ provider: "infistar", apiKey: "infistar-fixture" }];
  expect(await getUserCredential("user")).toEqual({ provider: "infistar", apiKey: "infistar-fixture" });
});
it("honors an explicitly selected provider", async () => {
  mocks.rows = [{ provider: "kie", apiKey: "kie-fixture" }, { provider: "infistar", apiKey: "infistar-fixture", isPreferred: true }];
  expect(await getUserCredential("user")).toEqual({ provider: "infistar", apiKey: "infistar-fixture" });
});
it("never silently falls back when the selected provider key cannot be decrypted", async () => {
  mocks.rows = [{ provider: "infistar", apiKey: "corrupt", isPreferred: true }, { provider: "kie", apiKey: "kie-fixture" }];
  await expect(getUserCredential("user")).rejects.toThrow("无法解密");
});
it("resolves a historical task against its pinned provider", async () => {
  mocks.pinned.mockResolvedValue("original-kie-fixture");
  expect(await getUserCredential("user", "kie")).toEqual({ provider: "kie", apiKey: "original-kie-fixture" });
  expect(mocks.pinned).toHaveBeenCalledWith("user", "kie");
});
it("returns no credential when none was configured", async () => {
  expect(await getUserCredential("user")).toBeNull();
});
