import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), preview: vi.fn(), submit: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/workflow/script-video-generation", () => ({ previewScriptVideo: mocks.preview, submitScriptVideo: mocks.submit, readScriptVideoJob: mocks.read }));
import { POST, GET } from "@/app/api/workflow/projects/[id]/script/video/route";
const id = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id }) };
const input = { action: "preview", versionId: id, revision: 1, language: "zh", settings: { duration: 30, resolution: "720p", aspectRatio: "16:9", generateAudio: false } };
const request = (body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/video", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("script-video route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: "owner" } }); mocks.preview.mockResolvedValue({ token: "signed" }); mocks.submit.mockResolvedValue({ generationId: id }); mocks.read.mockResolvedValue({ generationId: id }); });
  it("denies anonymous preview, paid confirmation and task retrieval", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(input), params)).status).toBe(401);
    expect((await POST(request({ action: "submit", token: "signed", confirmedCost: true }), params)).status).toBe(401);
    expect((await GET(new NextRequest(`http://localhost/api/video?generationId=${id}`), params)).status).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("requires same-origin and explicit cost confirmation, rejecting arbitrary parameter overrides", async () => {
    expect((await POST(request(input, "https://other.test"), params)).status).toBe(403);
    expect((await POST(request({ action: "submit", token: "signed" }), params)).status).toBe(400);
    expect((await POST(request({ action: "submit", token: "signed", confirmedCost: true, duration: 1 }), params)).status).toBe(400);
    expect((await POST(request({ ...input, settings: { ...input.settings, duration: 31 } }), params)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("pins the authenticated owner and project and serves uncached preview data", async () => {
    const response = await POST(request(input), params);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", projectId: id, revision: 1 }));
    await POST(request({ action: "submit", token: "signed", confirmedCost: true }), params);
    expect(mocks.submit).toHaveBeenCalledWith("owner", id, "signed");
    await GET(new NextRequest(`http://localhost/api/video?generationId=${id}`), params);
    expect(mocks.read).toHaveBeenCalledWith("owner", id, id);
  });
  it("reports overflow and stale previews clearly without leaking internal failures", async () => {
    mocks.preview.mockRejectedValue(new Error("SCRIPT_VIDEO_TOO_LONG"));
    const overflow = await POST(request(input), params);
    expect(overflow.status).toBe(400); expect((await overflow.json()).error).toContain("不会截断");
    mocks.submit.mockRejectedValue(new Error("SCRIPT_VIDEO_PREVIEW_EXPIRED"));
    expect((await POST(request({ action: "submit", token: "signed", confirmedCost: true }), params)).status).toBe(409);
    mocks.read.mockRejectedValue(new Error("database private detail"));
    const result = await GET(new NextRequest(`http://localhost/api/video?generationId=${id}`), params);
    expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("private detail");
  });
});
