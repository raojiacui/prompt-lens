import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLinkedMediaWithEasyDown, selectEasyDownMedia } from "@/lib/media-resolver/easydown";
import { resolveLinkedMedia } from "@/lib/media-resolver";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EASYDOWN_API_KEY;
  delete process.env.EASYDOWN_API_BASE_URL;
});

describe("EasyDown linked media resolver", () => {
  it("requires the EasyDown key at the public resolver entry point", async () => {
    delete process.env.EASYDOWN_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveLinkedMedia("https://www.bilibili.com/video/demo")).rejects.toThrow("请设置 EASYDOWN_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers a video with audio and carries public download headers", () => {
    const result = selectEasyDownMedia({
      status: 200,
      data: {
        videos: [
          { url: "https://cdn.example/video-only.mp4", mimeType: "video/mp4", width: 1920, height: 1080, hasAudio: false },
          { url: "https://cdn.example/with-audio.mp4", mimeType: "video/mp4", width: 640, height: 360, hasAudio: true, headers: { Referer: "https://www.bilibili.com/", Authorization: "secret" } },
        ],
        audios: [{ url: "https://cdn.example/audio.m4a", mimeType: "audio/mp4" }],
      },
    }, "bilibili");

    expect(result.videoUrl).toBe("https://cdn.example/with-audio.mp4");
    expect(result.audioUrl).toBeUndefined();
    expect(result.videoHeaders).toEqual({ Referer: "https://www.bilibili.com/" });
  });

  it("pairs a Bilibili video-only stream with audio", () => {
    const result = selectEasyDownMedia({
      status: 200,
      data: {
        videos: [{ url: "https://cdn.example/video.mp4", mimeType: "video/mp4", hasAudio: false }],
        audios: [{ url: "https://cdn.example/audio.m4a", mimeType: "audio/mp4", headers: { Referer: "https://www.bilibili.com/" } }],
      },
    }, "bilibili");

    expect(result.audioUrl).toBe("https://cdn.example/audio.m4a");
    expect(result.audioHeaders).toEqual({ Referer: "https://www.bilibili.com/" });
  });

  it("sends a server-side POST with the video URL", async () => {
    process.env.EASYDOWN_API_KEY = "test-token";
    process.env.EASYDOWN_API_BASE_URL = "https://resolver.example";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 200,
      data: { videos: [{ url: "https://cdn.example/video.mp4", mimeType: "video/mp4", hasAudio: true }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLinkedMedia("https://v.douyin.com/example/");

    expect(result.platform).toBe("douyin");
    expect(fetchMock).toHaveBeenCalledWith("https://resolver.example/api/v1/parse", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      body: JSON.stringify({ url: "https://v.douyin.com/example/" }),
    }));
  });

  it("rejects an empty success response", () => {
    expect(() => selectEasyDownMedia({ status: 200, data: { videos: [] } }, "tiktok")).toThrow("没有返回可下载");
  });

  it("rejects unsupported hosts before calling the provider", async () => {
    process.env.EASYDOWN_API_KEY = "test-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveLinkedMedia("https://example.com/video.mp4")).rejects.toThrow("目前仅支持");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects YouTube without spending a provider call", async () => {
    process.env.EASYDOWN_API_KEY = "test-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveLinkedMediaWithEasyDown("https://www.youtube.com/watch?v=demo")).rejects.toThrow("暂不支持 YouTube");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects X without spending a provider call", async () => {
    process.env.EASYDOWN_API_KEY = "test-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveLinkedMediaWithEasyDown("https://x.com/example/status/123")).rejects.toThrow("暂不支持 X");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
