import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVideoModelPayload } from "@/lib/ai/video-models";
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
});
