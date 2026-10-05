import { describe, expect, it } from "vitest";
import { estimateGeneration, GENERATION_PRICING_VERSION } from "@/lib/billing/pricing-v6";
import { buildKIEVeoPayload, isKIEVeoModel } from "@/lib/ai/adapters/kie-video";

describe("Veo verified billing configuration", () => {
  it.each([
    ["veo3_lite", "720p", 13, 150000], ["veo3_lite", "1080p", 15, 175000], ["veo3_lite", "4k", 59, 750000],
    ["veo3_fast", "720p", 25, 300000], ["veo3_fast", "1080p", 27, 325000], ["veo3_fast", "4k", 70, 900000],
    ["veo3", "720p", 97, 1250000], ["veo3", "1080p", 98, 1275000],
  ] as const)("prices %s %s per output", (modelId, resolution, credits, microUsd) => {
    for (const durationSeconds of [4, 6, 8]) {
      expect(estimateGeneration({ modelId, resolution, durationSeconds, audio: false })).toMatchObject({ credits, microUsd, version: GENERATION_PRICING_VERSION });
    }
  });
  it("recognizes the Quality model for provider queries", () => {
    expect(isKIEVeoModel("veo3")).toBe(true);
  });
  it("submits the same duration, resolution and model as the quote", () => {
    expect(buildKIEVeoPayload({ modelId: "veo3_fast", prompt: "test", duration: 6, resolution: "1080p", aspectRatio: "9:16" }, ["https://example.com/a.jpg"])).toMatchObject({
      model: "veo3_fast", duration: 6, resolution: "1080p", aspectRatio: "9:16", generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO", enableFallback: false,
    });
  });
  it("restricts three-image material reference to 8 seconds and Lite/Fast", () => {
    const images = ["a", "b", "c"].map(name => `https://example.com/${name}.jpg`);
    expect(buildKIEVeoPayload({ modelId: "veo3_lite", prompt: "test", duration: 8 }, images).generationType).toBe("REFERENCE_2_VIDEO");
    expect(() => buildKIEVeoPayload({ modelId: "veo3_fast", prompt: "test", duration: 6 }, images)).toThrow();
    expect(() => buildKIEVeoPayload({ modelId: "veo3", prompt: "test", duration: 8 }, images)).toThrow();
  });
  it("rejects video references, unsupported lengths and disputed Quality 4K prices", () => {
    for (const override of [{ durationSeconds: 5 }, { resolution: "480p" }, { referenceVideoSeconds: 5 }, { modelId: "veo3", resolution: "4k" }]) {
      expect(() => estimateGeneration({ modelId: "veo3_fast", resolution: "720p", durationSeconds: 8, audio: false, ...override })).toThrow("MODEL_PRICE_UNVERIFIED");
    }
  });
});
