import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVideoModelPayload, videoGenerationInput, videoModels } from "@/lib/ai/video-models";
import { KieVideoProvider } from "@/lib/ai/video-provider";

const wan = { model: "wan/2-6-text-to-video", prompt: "A cloud palace", duration: 5, resolution: "720p", aspectRatio: "9:16" };
describe("explicit video-model payloads", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("builds Wan 2.6 without using an environment default", () => {
    vi.stubEnv("KIE_VIDEO_MODEL", "wan/2-7-text-to-video");
    expect(buildVideoModelPayload(wan)).toEqual({ model: wan.model, input: { prompt: wan.prompt, duration: "5", resolution: "720p", aspect_ratio: "9:16", multi_shots: false } });
  });
  it("passes the chosen reference image to image-to-video", () => {
    const payload = buildVideoModelPayload({ ...wan, model: "wan/2-6-image-to-video", aspectRatio: "16:9", referenceImageUrls: ["https://example.com/image.png"] });
    expect(payload.input).toMatchObject({ image_urls: ["https://example.com/image.png"] });
  });
  it("uses Kling's own input contract", () => {
    expect(buildVideoModelPayload({ ...wan, model: "kling-2.6/text-to-video", resolution: "1080p" })).toEqual({ model: "kling-2.6/text-to-video", input: { prompt: wan.prompt, duration: "5", aspect_ratio: "9:16", sound: false } });
  });
  it("sends only the supplied personal key and selected model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { taskId: "task-1" } })));
    vi.stubGlobal("fetch", fetchMock);
    await new KieVideoProvider("personal-key-test-only").createTask(wan);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer personal-key-test-only");
    expect(JSON.parse(options.body).model).toBe(wan.model);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an absent model before sending any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new KieVideoProvider("personal-key-test-only").createTask({ ...wan, model: "" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(videoModels)("submits $label only with the supplied key", async (model) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { taskId: "task-1" } })));
    vi.stubGlobal("fetch", fetchMock);
    await new KieVideoProvider("personal-key-test-only").createTask({ ...wan, model: model.id, duration: model.durations[0], resolution: model.resolutions[0], aspectRatio: model.aspectRatios[0], referenceImageUrls: Array.from({ length: model.minImages }, () => "https://example.com/image.png") });
    const [url, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer personal-key-test-only");
    expect(JSON.parse(options.body).model).toBe(model.id);
    expect(url).toContain(model.family === "Veo" ? "/api/v1/veo/generate" : "/api/v1/jobs/createTask");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["bytedance/seedance-2", "bytedance/seedance-2-fast", "bytedance/seedance-2-mini", "bytedance/seedance-2-5"])("builds numeric duration and reference images for %s", (model) => {
    expect(buildVideoModelPayload({ ...wan, model, duration: 15, referenceImageUrls: ["https://example.com/image.png"] }).input).toMatchObject({ duration: 15, generate_audio: false, reference_image_urls: ["https://example.com/image.png"] });
  });
  it("uses Seedance 1.5's distinct image parameter", () => {
    expect(buildVideoModelPayload({ ...wan, model: "bytedance/seedance-1.5-pro", duration: 8, referenceImageUrls: ["https://example.com/image.png"] }).input).toMatchObject({ input_urls: ["https://example.com/image.png"], duration: 8, fixed_lens: false });
  });
  it("maps Lite 1.0 first and last images without losing either", () => {
    expect(buildVideoModelPayload({ ...wan, model: "bytedance/v1-lite-image-to-video", aspectRatio: "16:9", referenceImageUrls: ["https://example.com/first.png", "https://example.com/last.png"] }).input).toMatchObject({ image_url: "https://example.com/first.png", end_image_url: "https://example.com/last.png" });
  });
  it("maps Sora frames and orientation rather than Wan parameters", () => {
    expect(buildVideoModelPayload({ ...wan, model: "sora-2/image-to-video", duration: 15, referenceImageUrls: ["https://example.com/image.png"] }).input).toEqual({ prompt: wan.prompt, n_frames: "15", aspect_ratio: "portrait", remove_watermark: true, image_urls: ["https://example.com/image.png"] });
  });
  it("does not allow Veo to silently switch models", () => {
    expect(buildVideoModelPayload({ ...wan, model: "veo3_fast", duration: 8, referenceImageUrls: ["https://example.com/image.png"] })).toMatchObject({ enableFallback: false, generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO", imageUrls: ["https://example.com/image.png"] });
  });
  it("uses the dedicated Veo query endpoint and nested result URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { successFlag: 1, response: { resultUrls: ["https://example.com/video.mp4"] } } })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new KieVideoProvider("personal-key-test-only").getStatus("task-1", "veo3_fast")).toMatchObject({ status: "completed", videoUrl: "https://example.com/video.mp4" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/veo/record-info?taskId=task-1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer personal-key-test-only");
  });
  it.each([0, 2, 3])("maps Veo status flag %s", async (flag) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { successFlag: flag, errorMessage: "mock error" } }))));
    expect((await new KieVideoProvider("personal-key-test-only").getStatus("task-1", "veo3")).status).toBe(flag === 0 ? "processing" : "failed");
  });
  it("rejects excess images before submission", () => {
    expect(videoGenerationInput.safeParse({ ...wan, model: "veo3_fast", duration: 8, referenceImageUrls: Array(3).fill("https://example.com/image.png") }).success).toBe(false);
  });
});
