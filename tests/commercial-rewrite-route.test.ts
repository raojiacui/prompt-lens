import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/workflow/projects/[id]/scenes/[sceneVersionId]/rewrite/route";
import { rewriteSceneVersion } from "@/lib/workflow/service";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ user: { id: "owner" } })) } } }));
vi.mock("@/lib/billing/commercial-rewrite", () => ({ commercialRewriteEnabled: () => true }));
vi.mock("@/lib/byok/kie", () => ({ getUserKieApiKey: async () => "private-key" }));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "platform-key", resolveKieApiKeyForFeature: vi.fn(), kieAccessError: vi.fn() }));
vi.mock("@/lib/workflow/service", () => ({ rewriteSceneVersion: vi.fn() }));
const requestId = "11111111-1111-4111-8111-111111111111";
const call = (body: Record<string, unknown>) => POST(new NextRequest("http://localhost/api/rewrite", { method: "POST", body: JSON.stringify({ instruction: "Change the costume", requestId, ...body }) }), { params: Promise.resolve({ id: "project", sceneVersionId: "scene" }) });

describe("Commercial rewrite payer contract", () => {
  beforeEach(() => { vi.mocked(rewriteSceneVersion).mockReset().mockResolvedValue({ id: "new-scene" } as Awaited<ReturnType<typeof rewriteSceneVersion>>); });
  it("requires an explicit payer before any model work", async () => {
    expect((await call({})).status).toBe(400);
    expect(rewriteSceneVersion).not.toHaveBeenCalled();
  });
  it("binds included rewrites to the platform key and server-selected Pro", async () => {
    const response = await call({ payer: "included", modelId: "expensive-other", rewriteKeySource: "user" });
    expect(response.status).toBe(200);
    expect(rewriteSceneVersion).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", rewriteKeySource: "platform", allowPlatformKeyForRewrite: true, modelId: "analysis-gemini-2-5-pro", commercialTaskKey: `rewrite:${requestId}` }));
    expect((await response.json()).billing).toEqual({ payer: "included", chargedCredits: 0, includedRewrites: 1 });
  });
  it("does not reserve platform allowance for explicit BYOK", async () => {
    expect((await call({ payer: "byok" })).status).toBe(200);
    expect(rewriteSceneVersion).toHaveBeenCalledWith(expect.objectContaining({ rewriteKeySource: "user", allowPlatformKeyForRewrite: false, commercialTaskKey: undefined }));
  });
  it("rejects invalid retry identifiers", async () => {
    expect((await call({ payer: "included", requestId: "" })).status).toBe(400);
    expect(rewriteSceneVersion).not.toHaveBeenCalled();
  });
  it("keeps an unknown task pending but marks confirmed model failure refunded", async () => {
    vi.mocked(rewriteSceneVersion).mockRejectedValueOnce(new Error("REWRITE_IN_PROGRESS"));
    const pending = await call({ payer: "included" });
    expect(pending.status).toBe(409);
    expect((await pending.json()).final).toBe(false);
    vi.mocked(rewriteSceneVersion).mockRejectedValueOnce(new Error("REWRITE_PROVIDER_FAILED"));
    const failed = await call({ payer: "included" });
    expect(failed.status).toBe(502);
    expect((await failed.json()).final).toBe(true);
  });
});
