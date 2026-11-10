import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ credential: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: mocks.credential }));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "platform-fixture", resolveApiKeyForFeature: mocks.access }));
import { generationKeyFingerprint, resolveGenerationStatusKey } from "@/lib/billing/generation-key";
beforeEach(() => { vi.resetAllMocks(); });
it("never sends an Infistar preferred key to a historical KIE task", async () => {
  mocks.credential.mockResolvedValue(null);
  mocks.access.mockResolvedValue({ provider: "infistar", apiKey: "preferred-infistar-fixture" });
  expect(await resolveGenerationStatusKey("owner", {}, "kie")).toBeNull();
  expect(mocks.credential).toHaveBeenCalledWith("owner", "kie");
});
it("pins polling to the provider stored on the task", async () => {
  mocks.credential.mockResolvedValue({ provider: "infistar", apiKey: "original-infistar-fixture" });
  expect(await resolveGenerationStatusKey("owner", { billing: { keySource: "user", keyFingerprint: generationKeyFingerprint("original-infistar-fixture") } }, "infistar")).toBe("original-infistar-fixture");
  expect(mocks.credential).toHaveBeenCalledWith("owner", "infistar");
  expect(mocks.access).not.toHaveBeenCalled();
});
it("fails closed when the original key has been replaced", async () => {
  mocks.credential.mockResolvedValue({ provider: "infistar", apiKey: "replacement-fixture" });
  await expect(resolveGenerationStatusKey("owner", { billing: { keySource: "user", keyFingerprint: generationKeyFingerprint("original-fixture") } }, "infistar")).rejects.toThrow("KEY_CHANGED");
});
it("never uses a platform KIE credential for Infistar polling", async () => {
  expect(await resolveGenerationStatusKey("owner", { billing: { keySource: "platform_paid" } }, "infistar")).toBeNull();
});
