import { describe, expect, it } from "vitest";
import { generationCreditPreview } from "@/lib/billing/generation-credit-preview";

const base = { resolution: "720P", duration: 5, quantity: 1, hasImages: false, hasVideo: false };
describe("Generation button credit previews", () => {
  it.each([
    [undefined, "720P", 5, 1, 29],
    ["wan/2-6-text-to-video", "1080P", 5, 2, 84],
    ["bytedance/seedance-2-fast", "720P", 5, 4, 196],
    ["bytedance/seedance-2", "720P", 10, 1, 157],
    ["bytedance/seedance-2-mini", "480P", 5, 1, 9],
    ["bytedance/seedance-2-mini", "720P", 5, 1, 18],
    ["kling-3.0/video", "720P", 5, 1, 29],
    ["kling-2.6/text-to-video", "1080P", 5, 1, 23],
    ["veo3_lite", "720P", 4, 1, 13],
    ["veo3_fast", "1080P", 8, 2, 54],
    ["veo3", "1080P", 6, 1, 98],
  ] as const)("updates %s %s %is x%i", (model, resolution, duration, quantity, total) => {
    expect(generationCreditPreview({ ...base, model, resolution, duration, quantity })).toMatchObject({ state: "priced", total });
  });
  it("waits for reference timing instead of displaying zero credits", () => {
    expect(generationCreditPreview({ ...base, hasVideo: true })).toEqual({ state: "pending" });
    expect(generationCreditPreview({ ...base, hasVideo: true, referenceSeconds: 5, duration: 10 })).toMatchObject({ state: "priced", total: 87 });
  });
  it.each([["wan/2-7-videoedit", 32]] as const)("prices original-duration %s", (model, total) => {
    expect(generationCreditPreview({ ...base, model, hasVideo: true, referenceSeconds: 5, duration: 0 })).toMatchObject({ state: "priced", total });
  });
  it("does not invent prices for unsupported models, durations or batch sizes", () => {
    for (const override of [{ model: "veo3_fast" }, { model: "sora-2/text-to-video" }, { model: "grok-imagine/text-to-video" }, { model: "happyhorse/video-edit" }, { model: "kling-omni/transformation" }, { duration: 8 }, { quantity: 5 }]) {
      expect(generationCreditPreview({ ...base, ...override })).toEqual({ state: "unavailable" });
    }
  });
});
