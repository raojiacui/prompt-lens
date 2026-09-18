import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveLinkedMedia: vi.fn(),
  ingestLinkedMedia: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/media-resolver/leaperone", () => ({ resolveLinkedMediaWithLeaperOne: mocks.resolveLinkedMedia }));
vi.mock("@/lib/ffmpeg-worker/client", () => ({ ingestLinkedMediaWithWorker: mocks.ingestLinkedMedia }));
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: mocks.insertValues }) }, operationLogs: {} }));

import { POST } from "@/app/api/media/resolve-link/route";

function request(url = "https://www.youtube.com/watch?v=demo", origin = "http://localhost") {
  return new NextRequest("http://localhost/api/media/resolve-link", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

describe("linked media resolver route", () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ user: { id: "owner" } });
    mocks.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 2, resetIn: 60_000 });
    mocks.resolveLinkedMedia.mockReset().mockResolvedValue({
      platform: "youtube",
      videoUrl: "https://provider.example/video",
      filename: "youtube-linked-video.mp4",
      title: "A useful demo",
      duration: 42,
    });
    mocks.ingestLinkedMedia.mockReset().mockResolvedValue({
      mediaUrl: "https://media.example/linked-video.mp4",
      storageKey: "linked-media/youtube/id.mp4",
      mediaType: "video",
      platform: "youtube",
      filename: "youtube-linked-video.mp4",
      metadata: { duration: 42, width: 1920, height: 1080 },
    });
    mocks.insertValues.mockReset().mockResolvedValue(undefined);
  });

  it("stores resolved media as an owned upload for the analysis flow", async () => {
    const response = await POST(request());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ platform: "youtube", duration: 42, title: "A useful demo" });
    expect(mocks.ingestLinkedMedia).toHaveBeenCalledWith(expect.objectContaining({ platform: "youtube" }));
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner",
      action: "file.upload",
      metadata: expect.objectContaining({ phase: "server-upload", source: "linked-media" }),
    }));
  });

  it("rejects cross-origin requests before spending a provider call", async () => {
    const response = await POST(request(undefined, "https://other.example"));
    expect(response.status).toBe(403);
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
  });

  it("rate limits repeated resolutions per user", async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetIn: 12_000 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
  });

  it("returns a service error when the provider key is not configured", async () => {
    mocks.resolveLinkedMedia.mockRejectedValue(new Error("链接解析服务未配置：请设置 LEAPERONE_API_KEY"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "LINK_RESOLVER_NOT_CONFIGURED", error: "视频链接解析服务尚未启用。" });
  });
});
