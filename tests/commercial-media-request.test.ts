import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, operationLogs: {} }));
vi.mock("@/lib/cloudflare/r2", () => ({ extractR2Key: () => "uploads/video.mp4", getSignedUrlFromR2: async () => "https://storage.example/signed" }));
import { commercialMediaRequest } from "@/lib/billing/commercial-media";
import { taskErrorDetails } from "@/lib/billing/task-diagnostics";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("preserves the worker status and sanitized explanation without resubmitting", async () => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-test-secret");
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Media download failed https://storage.example/private?signature=secret" }, { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  let failure: unknown;
  try { await commercialMediaRequest("https://storage.example/video", { mode: "assets" }); }
  catch (error) { failure = error; }
  expect(taskErrorDetails(failure)).toMatchObject({ message: "MEDIA_PREPARATION_FAILED", cause: { code: "MEDIA_HTTP_503", message: "Media download failed [URL]" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("retains the HTTP status when the proxy responds with HTML", async () => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-test-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 })));
  let failure: unknown;
  try { await commercialMediaRequest("https://storage.example/video", { mode: "assets" }); }
  catch (error) { failure = error; }
  expect(taskErrorDetails(failure)).toMatchObject({ cause: { code: "MEDIA_HTTP_502" } });
});

it.each(["UNSUPPORTED_VIDEO_CODEC", "INVALID_VIDEO_STREAM", "SCENE_DETECTION_FAILED"])("preserves a known media failure code: %s", async (code) => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-test-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code, error: "Cannot inspect video" }, { status: 422 })));
  await expect(commercialMediaRequest("https://storage.example/video", { mode: "preview", automaticSplit: true })).rejects.toThrow(code);
});

it("does not expose arbitrary worker error codes", async () => {
  vi.stubEnv("FFMPEG_WORKER_URL", "https://worker.example");
  vi.stubEnv("FFMPEG_WORKER_SECRET", "worker-test-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "PRIVATE_PROVIDER_VALUE", error: "Cannot inspect video" }, { status: 500 })));
  await expect(commercialMediaRequest("https://storage.example/video", { mode: "preview" })).rejects.toThrow("MEDIA_PREPARATION_FAILED");
});
