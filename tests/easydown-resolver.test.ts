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

  it("keeps alternate MP4 renditions from one parse response for codec fallback", () => {
    const result = selectEasyDownMedia({ data: { videos: [
      { url: "https://cdn.example/unsupported.mp4", mimeType: "video/mp4", width: 1920, height: 1080, hasAudio: true },
      { url: "https://cdn.example/compatible.mp4", mimeType: "video/mp4", width: 1280, height: 720, hasAudio: true, headers: { Referer: "https://www.douyin.com/", Authorization: "private" } },
      { url: "https://cdn.example/compatible.mp4", mimeType: "video/mp4", hasAudio: true },
    ] } }, "douyin");
    expect(result.videoUrl).toBe("https://cdn.example/unsupported.mp4");
    expect(result.videoCandidates?.map(item => item.videoUrl)).toEqual([
      "https://cdn.example/unsupported.mp4", "https://cdn.example/compatible.mp4",
    ]);
    expect(result.videoCandidates?.[1].videoHeaders).toEqual({ Referer: "https://www.douyin.com/" });
  });

  it("uses Douyin platform metadata to exclude higher resolution ByteVC2 and prefer H.264", () => {
    const avcUrl = "https://cdn.example/avc.mp4?signature=avc";
    const hevcUrl = "https://cdn.example/hevc.mp4?signature=hevc";
    const bvcUrl = "https://cdn.example/bytevc2.mp4?signature=bvc";
    const unknownUrl = "https://cdn.example/unknown.mp4?signature=unknown";
    const result = selectEasyDownMedia({ data: {
      media: {
        title: "  compatible source  ", duration: 12,
        videos: [
          { url: bvcUrl, mimeType: "video/mp4", width: 3840, height: 2160, hasAudio: true },
          { url: unknownUrl, mimeType: "video/mp4", width: 2560, height: 1440, hasAudio: true },
          { url: hevcUrl, mimeType: "video/mp4", width: 1920, height: 1080, hasAudio: true },
          { url: avcUrl, mimeType: "video/mp4", width: 1280, height: 720, hasAudio: true,
            headers: { Referer: "https://www.douyin.com/", Authorization: "private" } },
        ],
      },
      platformData: { aweme_detail: { video: {
        play_addr_h264: { url_list: [avcUrl], url_key: "video_h264_720p_1000000" },
        play_addr_265: { url_list: [hevcUrl], url_key: "video_bytevc1_1080p_1500000" },
        bit_rate: [{ is_h265: 2, is_bytevc1: 2, play_addr: { url_list: [bvcUrl], url_key: "video_bytevc2_2160p_2000000" } }],
      } } },
    } }, "douyin");

    expect(result.videoUrl).toBe(avcUrl);
    expect(result.videoCodec).toBe("h264");
    expect(result.videoHeaders).toEqual({ Referer: "https://www.douyin.com/" });
    expect(result.videoCandidates?.map(item => [item.videoUrl, item.videoCodec])).toEqual([
      [avcUrl, "h264"], [hevcUrl, "hevc"], [unknownUrl, undefined],
    ]);
    expect(result.title).toBe("compatible source");
    expect(result.duration).toBe(12);
  });

  it("joins codec metadata by exact URL and does not infer H.264 from zero flags", () => {
    const exact = "https://cdn.example/shared.mp4?signature=first";
    const otherSignature = "https://cdn.example/shared.mp4?signature=second";
    const unlabeled = "https://cdn.example/unlabeled.mp4";
    const result = selectEasyDownMedia({ data: {
      media: { videos: [
        { url: otherSignature, width: 1920, height: 1080, hasAudio: true },
        { url: unlabeled, width: 1280, height: 720, hasAudio: true },
        { url: exact, width: 640, height: 360, hasAudio: true },
      ] },
      platformData: { video: {
        play_addr_h264: { url_list: [exact], url_key: "video_h264_360p_500000" },
        bit_rate: [{ is_h265: 0, is_bytevc1: 0, play_addr: { url_list: [unlabeled] } }],
      } },
    } }, "douyin");

    expect(result.videoUrl).toBe(exact);
    expect(result.videoCandidates?.map(item => item.videoCodec)).toEqual(["h264", undefined, undefined]);
    expect(result.videoCandidates?.[1].videoUrl).toBe(otherSignature);
  });

  it.each(["is_h265", "is_bytevc1"])("gives ByteVC2 %s enum conflicts precedence and rejects unsupported versions", (flag) => {
    const url = "https://cdn.example/conflict.mp4";
    expect(() => selectEasyDownMedia({ data: {
      media: { videos: [{ url, mimeType: "video/mp4", hasAudio: true }] },
      platformData: { video: {
        play_addr_h264: { url_list: [url], url_key: "video_h264_720p_1000000" },
        bit_rate: [{ [flag]: 2, play_addr: { url_list: [url], url_key: "video_h264_720p_1000000" } }],
      } },
    } }, "douyin")).toThrow("视频版本编码不受支持");
  });

  it("excludes an explicit ByteVC2 url_key even when the rendition is under play_addr_h264", () => {
    const url = "https://cdn.example/mislabeled.mp4";
    expect(() => selectEasyDownMedia({ data: {
      media: { videos: [{ url, hasAudio: true }] },
      platformData: { video: {
        play_addr_h264: { url_list: [url], url_key: "video_bytevc2_720p_1000000" },
      } },
    } }, "douyin")).toThrow("视频版本编码不受支持");
  });

  it("pairs audio separately for each alternate rendition", () => {
    const result = selectEasyDownMedia({ data: {
      videos: [
        { url: "https://cdn.example/muxed.mp4", hasAudio: true },
        { url: "https://cdn.example/video-only.mp4", hasAudio: false },
      ],
      audios: [{ url: "https://cdn.example/audio.m4a", mimeType: "audio/mp4" }],
    } }, "bilibili");
    expect(result.videoCandidates?.[0].audioUrl).toBeUndefined();
    expect(result.videoCandidates?.[1].audioUrl).toBe("https://cdn.example/audio.m4a");
  });

  it("bounds fallback candidates and excludes silent Bilibili streams without audio", () => {
    const result = selectEasyDownMedia({ data: { videos: [
      ...Array.from({ length: 20 }, (_, index) => ({ url: `https://cdn.example/${index}.mp4`, hasAudio: true })),
      { url: "https://cdn.example/silent.mp4", hasAudio: false },
    ] } }, "bilibili");
    expect(result.videoCandidates).toHaveLength(12);
    expect(result.videoCandidates?.some(item => item.videoUrl.endsWith("silent.mp4"))).toBe(false);
  });

  it("sends a server-side POST with the video URL", async () => {
    process.env.EASYDOWN_API_KEY = "test-token";
    process.env.EASYDOWN_API_BASE_URL = "https://resolver.example";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 200,
      data: {
        media: { videos: [{ url: "https://cdn.example/video.mp4", mimeType: "video/mp4", hasAudio: true }] },
        platformData: { video: { play_addr_h264: { url_list: ["https://cdn.example/video.mp4"] } } },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLinkedMedia("https://v.douyin.com/example/");

    expect(result.platform).toBe("douyin");
    expect(result.videoCodec).toBe("h264");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://resolver.example/api/v1/platforms/douyin/parse", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      body: JSON.stringify({ url: "https://v.douyin.com/example/" }),
    }));
  });

  it.each([
    ["tiktok", "https://www.tiktok.com/@example/video/123"],
    ["bilibili", "https://www.bilibili.com/video/BVexample"],
  ])("keeps %s on the common parse endpoint", async (platform, url) => {
    process.env.EASYDOWN_API_KEY = "test-token";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 200, data: {
      videos: [{ url: "https://cdn.example/video.mp4", hasAudio: true }],
    } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await resolveLinkedMediaWithEasyDown(url)).platform).toBe(platform);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.easydown.org/api/v1/parse", expect.anything());
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
