import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkLinkedMediaWorker, ingestLinkedMediaWithWorker } from "@/lib/ffmpeg-worker/client";

beforeEach(() => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example/");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "test-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const source = { platform: "bilibili" as const, videoUrl: "https://cdn.example/video.mp4" };
describe("linked media worker connection", () => {
  it("validates authentication without requesting any media", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Missing videoUrl" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await checkLinkedMediaWorker();
    expect(fetchMock).toHaveBeenCalledWith("https://worker.example/ingest-media", expect.objectContaining({
      method: "POST", body: "{}", headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
    }));
  });

  it.each([401, 403, 500, 429, 404, 200])("rejects an unready worker returning %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Not ready" }, { status })));
    await expect(checkLinkedMediaWorker()).rejects.toThrow("尚未调用收费解析接口");
  });

  it("blocks a paid call when the readiness request times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(checkLinkedMediaWorker()).rejects.toThrow("尚未调用收费解析接口");
  });

  it("does not describe processing timeouts as missing configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(ingestLinkedMediaWithWorker(source)).rejects.toThrow("媒体下载或入库处理超过四分钟");
  });

  it("reads updated worker configuration without reloading the module", async () => {
    vi.stubEnv("FFMPEG_WORKER_URL", "https://new-worker.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ mediaUrl: "https://r2.example/video.mp4", metadata: { duration: 10 } }));
    vi.stubGlobal("fetch", fetchMock);
    await ingestLinkedMediaWithWorker(source);
    expect(fetchMock).toHaveBeenCalledWith("https://new-worker.example/ingest-media", expect.anything());
  });

  it("passes alternate renditions in the same ingestion request", async () => {
    const alternatives = [source, { videoUrl: "https://cdn.example/h264.mp4", videoHeaders: { Referer: "https://www.bilibili.com/" } }];
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ mediaUrl: "https://r2.example/video.mp4", metadata: { duration: 10 } }));
    vi.stubGlobal("fetch", fetchMock);
    await ingestLinkedMediaWithWorker({ ...source, videoCandidates: alternatives });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ videoCandidates: alternatives });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("explains unsupported codecs instead of accepting a stored video", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "UNSUPPORTED_VIDEO_CODEC", error: "unknown codec bvc2" }, { status: 422 })));
    await expect(ingestLinkedMediaWithWorker(source)).rejects.toThrow("未完成导入");
  });
});
