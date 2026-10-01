import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn(), provider: vi.fn(), task: vi.fn(), rate: vi.fn(), insert: vi.fn(), values: vi.fn(), returning: vi.fn(), findFirst: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/ai/video-generator", () => ({ DEFAULT_VIDEO_PROVIDER: "kie", getUserProviderApiKey: mocks.key, createVideoProvider: mocks.provider }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert, query: { videoGeneration: { findFirst: mocks.findFirst } } }, videoGeneration: {} }));
import { POST, GET } from "@/app/api/video-generate/route";
import { GET as statusGET } from "@/app/api/video-generate/status/route";
import { videoModels } from "@/lib/ai/video-models";

const valid = { model: "wan/2-6-text-to-video", prompt: "A cinematic cloud palace", duration: 5, resolution: "720p", aspectRatio: "16:9" };
const request = (body: unknown) => new NextRequest("http://localhost/api/video-generate", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("V1 personal-key generation boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("KIE_API_KEY", "platform-key-test-only");
    vi.stubEnv("KIE_AI_API_KEY", "platform-alias-test-only");
    mocks.session.mockResolvedValue({ user: { id: "user-1" } });
    mocks.rate.mockReturnValue({ allowed: true });
    mocks.key.mockResolvedValue(undefined);
    mocks.provider.mockReturnValue({ createTask: mocks.task, getStatus: mocks.status });
    mocks.task.mockResolvedValue({ taskId: "task-1", raw: {} });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([{ id: "record-1" }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["user", "admin"])("rejects %s without a personal key even with platform keys configured", async (role) => {
    mocks.session.mockResolvedValue({ user: { id: "user-1", role } });
    const res = await POST(request(valid));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PERSONAL_API_KEY_REQUIRED" });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each(videoModels)("never uses platform keys for $label", async (model) => {
    const res = await POST(request({ ...valid, model: model.id, duration: model.durations[0], resolution: model.resolutions[0], aspectRatio: model.aspectRatios[0], referenceImageUrls: Array.from({ length: model.minImages }, () => "https://example.com/image.png") }));
    expect(res.status).toBe(403);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("uses the user's key and persists the chosen model", async () => {
    mocks.key.mockResolvedValue("personal-key-test-only");
    expect((await POST(request(valid))).status).toBe(200);
    expect(mocks.provider).toHaveBeenCalledWith("kie", "personal-key-test-only");
    expect(mocks.task).toHaveBeenCalledWith(expect.objectContaining(valid));
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ model: valid.model }));
  });
  it.each([
    { ...valid, model: undefined },
    { ...valid, model: "wan/2-7-text-to-video" },
    { ...valid, provider: "runway" },
    { ...valid, duration: 100 },
    { ...valid, resolution: "4k" },
    { ...valid, model: "kling-2.6/text-to-video", resolution: "1080p", duration: 15 },
    { ...valid, referenceImageUrls: ["https://example.com/image.png"] },
    { ...valid, model: "wan/2-6-image-to-video", referenceImageUrls: [] },
  ])("rejects unselected, unknown or unsupported settings before generation: %j", async (body) => {
    mocks.key.mockResolvedValue("personal-key-test-only");
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("requires login", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(valid))).status).toBe(401);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("fails closed when personal-key lookup fails", async () => {
    mocks.key.mockRejectedValue(new Error("KEY_LOOKUP_FAILED"));
    expect((await POST(request(valid))).status).toBe(502);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("exposes only key availability, never a key", async () => {
    mocks.key.mockResolvedValue("personal-key-test-only");
    const res = await GET(new NextRequest("http://localhost/api/video-generate?access=true"));
    expect(await res.json()).toEqual({ hasOwnApiKey: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not fall back to platform keys when querying an old task", async () => {
    mocks.findFirst.mockResolvedValue({ provider: "kie" });
    expect((await statusGET(new NextRequest("http://localhost/api/video-generate/status?taskId=old-task"))).status).toBe(403);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
