import { describe, expect, it } from "vitest";
import { generationChoices, resolveGenerationModel } from "@/lib/ai/generation-models";
import { buildMarketGenerationPayload } from "@/lib/ai/generation-payload";
import { generationCreditPreview } from "@/lib/billing/generation-credit-preview";
import { estimateGeneration } from "@/lib/billing/pricing-v6";
import { buildKIEJobPayload, buildKIEWanVideoEditPayload } from "@/lib/ai/adapters/kie-video";

describe("Generation model families and material routing", () => {
  it.each([
    ["wan/2-6-text-to-video", false, false, "wan/2-6-text-to-video"],
    ["wan/2-6-text-to-video", true, false, "wan/2-6-image-to-video"],
    ["wan/2-6-text-to-video", false, true, "wan/2-6-video-to-video"],
    ["wan/2-7-text-to-video", false, false, "wan/2-7-text-to-video"],
    ["wan/2-7-text-to-video", true, false, "wan/2-7-image-to-video"],
    ["wan/2-7-text-to-video", true, true, "wan/2-7-r2v"],
    ["kling-2.6/text-to-video", true, false, "kling-2.6/image-to-video"],
    ["wan/2-7-videoedit", true, true, "wan/2-7-videoedit"],
  ])("routes %s with images=%s video=%s", (id, hasImages, hasVideo, expected) => {
    expect(resolveGenerationModel(id as string, { hasImages: Boolean(hasImages), hasVideo: Boolean(hasVideo) }).kieModelId).toBe(expected);
  });

  it("lists families once without losing separate editing intent", () => {
    const ids = generationChoices().map(m => m.kieModelId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("wan/2-7-videoedit");
    expect(ids).not.toContain("wan/2-6-image-to-video");
    expect(ids).not.toContain("wan/2-7-r2v");
    expect(ids).not.toContain("kling-2.6/image-to-video");
  });

  it("uses official Wan 2.7 request field names", () => {
    const request = { modelId: "wan/2-7-text-to-video", prompt: "A cinematic landscape", duration: 6, resolution: "1080p", aspectRatio: "16:9" };
    expect(buildMarketGenerationPayload(request).input).toMatchObject({ ratio: "16:9", duration: 6 });
    expect(buildMarketGenerationPayload(request, ["first", "last"])).toMatchObject({
      model: "wan/2-7-image-to-video", input: { first_frame_url: "first", last_frame_url: "last" },
    });
    expect(buildMarketGenerationPayload({ ...request, referenceVideoUrl: "video" }, ["image"])).toMatchObject({
      model: "wan/2-7-r2v", input: { reference_video: ["video"], reference_image: ["image"] },
    });
    expect(buildMarketGenerationPayload({ ...request, modelId: "wan/2-7-videoedit", referenceVideoUrl: "video" }, ["image"])).toMatchObject({
      model: "wan/2-7-videoedit", input: { video_url: "video", reference_image: "image" },
    });
  });

  it("uses the same material mapping for own-key adapter requests", () => {
    const request = { modelId: "wan/2-7-text-to-video", prompt: "A cinematic landscape", duration: 5, resolution: "720p" };
    expect(buildKIEJobPayload(request, ["first"])).toEqual(buildMarketGenerationPayload(request, ["first"]));
    expect(buildKIEJobPayload({ ...request, modelId: "kling-2.6/text-to-video", resolution: "1080p" }, ["first"])).toMatchObject({
      model: "kling-2.6/image-to-video", input: { duration: "5", image_urls: ["first"] },
    });
    expect(buildKIEWanVideoEditPayload({ ...request, modelId: "wan/2-7-videoedit", duration: 0 }, "video", "first")).toEqual(
      buildMarketGenerationPayload({ ...request, modelId: "wan/2-7-videoedit", duration: 0, referenceVideoUrl: "video" }, ["first"]),
    );
  });

  it("prices every advertised resolution and duration for valid text, image and video inputs", () => {
    let checked = 0;
    for (const choice of generationChoices()) {
      for (const materials of [{ hasImages: false, hasVideo: false }, { hasImages: true, hasVideo: false }, { hasImages: false, hasVideo: true }]) {
        let model;
        try { model = resolveGenerationModel(choice.kieModelId, materials); }
        catch { continue; }
        for (const resolution of model.resolutionOptions || []) {
          for (const duration of model.durationOptions || [0]) {
            const preview = generationCreditPreview({ model: choice.kieModelId, resolution, duration, quantity: 1, ...materials, referenceSeconds: materials.hasVideo ? 5 : undefined });
            expect(preview, JSON.stringify({ model: choice.kieModelId, resolution, duration, materials })).toMatchObject({
              state: "priced", total: estimateGeneration({ modelId: model.kieModelId, resolution, durationSeconds: duration || 5, referenceVideoSeconds: materials.hasVideo ? 5 : undefined, audio: false }).credits,
            });
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("rejects unsupported duration/resolution and image-video combinations", () => {
    const input = { prompt: "A cinematic landscape", duration: 5, resolution: "720p" };
    for (const request of [
      { ...input, modelId: "bytedance/seedance-2-fast", resolution: "1080p" },
      { ...input, modelId: "kling-2.6/text-to-video" },
      { ...input, modelId: "wan/2-6-text-to-video", duration: 4 },
    ]) expect(() => buildMarketGenerationPayload(request)).toThrow();
    expect(() => buildMarketGenerationPayload({ ...input, modelId: "wan/2-6-text-to-video", referenceVideoUrl: "video" }, ["image"])).toThrow();
  });

  it("charges Veo per video and Wan 2.7 by output duration", () => {
    for (const modelId of ["veo3", "veo3_fast", "veo3_lite"]) {
      const prices = [4, 6, 8].map(durationSeconds => estimateGeneration({ modelId, resolution: "720p", durationSeconds, audio: false }).credits);
      expect(new Set(prices).size).toBe(1);
    }
    expect(estimateGeneration({ modelId: "wan/2-7-r2v", resolution: "720p", durationSeconds: 5, referenceVideoSeconds: 10, audio: false }).credits).toBe(32);
    expect(estimateGeneration({ modelId: "wan/2-7-text-to-video", resolution: "720p", durationSeconds: 10, audio: false }).credits).toBe(63);
  });
});
