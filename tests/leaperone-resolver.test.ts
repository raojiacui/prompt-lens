import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLinkedMediaWithLeaperOne, selectLeaperMedia } from "@/lib/media-resolver/leaperone";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LEAPERONE_API_KEY;
  delete process.env.LEAPERONE_API_BASE_URL;
});

describe("LEAPERone linked media resolver", () => {
  it("prefers a muxed MP4 for YouTube", () => {
    const result = selectLeaperMedia({
      data: {
        videos: [
          { url: "https://cdn.example/video-1080.webm", quality: "1080p", format: "webm", codec: "vp9", width: 1920, height: 1080 },
          { url: "https://cdn.example/video-360.mp4", quality: "360p", format: "mp4", codec: "avc1, mp4a", width: 640, height: 360 },
        ],
        audios: [{ url: "https://cdn.example/audio.m4a", format: "m4a" }],
      },
    }, "youtube");

    expect(result).toMatchObject({ platform: "youtube", videoUrl: "https://cdn.example/video-360.mp4" });
    expect(result.audioUrl).toBeUndefined();
  });

  it("pairs a Bilibili video-only stream with audio", () => {
    const result = selectLeaperMedia({
      data: {
        videos: [{ url: "https://cdn.example/video.mp4", format: "mp4", codec: "avc1", width: 1280, height: 720 }],
        audios: [{ url: "https://cdn.example/audio.m4a", format: "m4a" }],
      },
    }, "bilibili");

    expect(result.videoUrl).toBe("https://cdn.example/video.mp4");
    expect(result.audioUrl).toBe("https://cdn.example/audio.m4a");
  });

  it("calls the configured API with bearer authentication", async () => {
    process.env.LEAPERONE_API_KEY = "test-key";
    process.env.LEAPERONE_API_BASE_URL = "https://resolver.example";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      platform: "douyin",
      data: { videos: [{ url: "https://cdn.example/video.mp4", format: "mp4", width: 1080, height: 1920 }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLinkedMediaWithLeaperOne("https://v.douyin.com/example/");

    expect(result.platform).toBe("douyin");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain("/v1/social-media/video/extract?url=");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("rejects unsupported source hosts before calling the provider", async () => {
    process.env.LEAPERONE_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response());
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveLinkedMediaWithLeaperOne("https://example.com/video.mp4")).rejects.toThrow("目前仅支持");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
