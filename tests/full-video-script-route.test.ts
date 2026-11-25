import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), save: vi.fn(), rewrite: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/workflow/full-video-script-store", () => ({ readFullVideoScript: mocks.read, saveFullVideoScript: mocks.save }));
vi.mock("@/lib/workflow/full-video-script-rewrite", () => ({ proposeScriptRewrite: mocks.rewrite }));
vi.mock("@/lib/billing/commercial-rewrite", () => ({ commercialRewriteEnabled: mocks.enabled }));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "platform-key" }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: async () => ({ apiKey: "user-key", provider: "kie" }) }));
import { GET, PUT } from "@/app/api/workflow/projects/[id]/script/route";
import { POST } from "@/app/api/workflow/projects/[id]/script/rewrite/route";
const versionId = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id: "project" }) };
const content = { title: "Script", summary: "A story", globalStyle: "", characters: "", continuityNotes: "", scenes: [] };
const request = (method: string, body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/script", { method, headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const update = { versionId, revision: 3, action: "save", content };
const rewrite = { versionId, revision: 3, requestId: versionId, instruction: "Rewrite", sceneIds: [], language: "zh", payer: "included" };
describe("script API authorization and revision contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: "owner" } }); mocks.enabled.mockReturnValue(true);
    mocks.read.mockResolvedValue({ revision: 3, content, history: [], candidates: [] }); mocks.save.mockResolvedValue({ revision: 4 }); mocks.rewrite.mockResolvedValue({ requestId: versionId });
  });
  it("denies all anonymous reads, writes, exports and inference", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new NextRequest(`http://localhost/api/script?versionId=${versionId}&format=txt&revision=3`), params)).status).toBe(401);
    expect((await PUT(request("PUT", update), params)).status).toBe(401);
    expect((await POST(request("POST", rewrite), params)).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.rewrite).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before accessing the store or model", async () => {
    expect((await PUT(request("PUT", update, "https://other.test"), params)).status).toBe(403);
    expect((await POST(request("POST", rewrite, "https://other.test"), params)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.rewrite).not.toHaveBeenCalled();
  });
  it("binds owner and current revision, exposing no internal errors", async () => {
    expect((await PUT(request("PUT", update), params)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", projectId: "project", versionId, revision: 3 }));
    mocks.save.mockRejectedValue(new Error("SCRIPT_CONFLICT"));
    expect((await PUT(request("PUT", update), params)).status).toBe(409);
    mocks.read.mockRejectedValue(new Error("private database detail"));
    const response = await GET(new NextRequest(`http://localhost/api/script?versionId=${versionId}`), params);
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private database");
  });
  it("exports only the requested saved revision as an uncached attachment", async () => {
    const call = (revision: number) => GET(new NextRequest(`http://localhost/api/script?versionId=${versionId}&format=txt&revision=${revision}`), params);
    expect((await call(2)).status).toBe(409);
    const response = await call(3);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(await response.text()).toContain("A story");
  });
  it("requires explicit billing, uses server-selected keys and respects the release flag", async () => {
    expect((await POST(request("POST", { ...rewrite, payer: undefined }), params)).status).toBe(400);
    expect((await POST(request("POST", rewrite), params)).status).toBe(200);
    expect(mocks.rewrite).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "owner", apiKey: "platform-key", payer: "included" }));
    expect((await POST(request("POST", { ...rewrite, payer: "byok" }), params)).status).toBe(200);
    expect(mocks.rewrite).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: "user-key", payer: "byok" }));
    mocks.enabled.mockReturnValue(false);
    expect((await POST(request("POST", rewrite), params)).status).toBe(403);
  });
  it("rejects tampered fields and reports unknown rewrite state as retryable", async () => {
    expect((await POST(request("POST", { ...rewrite, apiKey: "override", rewrites: 0 }), params)).status).toBe(400);
    mocks.rewrite.mockRejectedValue(new Error("database connection lost after model call"));
    const response = await POST(request("POST", rewrite), params);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ final: false, code: "SCRIPT_STATUS_UNKNOWN" });
  });
});
