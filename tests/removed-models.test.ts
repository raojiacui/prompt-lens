import { describe, expect, it } from "vitest";
import { getModelById, listModels, resolveModelSelection } from "@/lib/ai/model-registry";
import { buildKIEJobPayload } from "@/lib/ai/adapters/kie-video";
import { buildCommercialGenerationPayload } from "@/lib/billing/commercial-generation";

describe("removed model choices", () => {
  it.each(["analysis-gemini-2-5-pro", "gemini-2.5-pro", "grok-imagine-text-video", "grok-imagine/text-to-video", "grok-imagine-video-1-5-preview", "happyhorse-video-edit", "happyhorse/video-edit", "kling-omni-transform", "kling-omni/transformation", "kling-3.0-omni/transformation"])("excludes %s from the catalog and manual routing", modelId => {
    expect(getModelById(modelId)).toBeUndefined();
    expect(() => resolveModelSelection("analysis", { mode: "manual", modelId })).toThrow();
    expect(() => buildCommercialGenerationPayload({ model: modelId, prompt: "A cinematic landscape", duration: 5, quality: "720p" })).toThrow("PAID_MODEL_NOT_VERIFIED");
  });
  it.each(["grok-imagine/text-to-video", "grok-imagine-video-1-5-preview", "happyhorse/video-edit", "kling-omni/transformation", "kling-3.0-omni/transformation"])("rejects direct KIE submission for %s", modelId => {
    expect(() => buildKIEJobPayload({ modelId, prompt: "A cinematic landscape" })).toThrow("MODEL_UNAVAILABLE");
  });
  it("keeps other Kling, Wan and Gemini models available", () => {
    expect(listModels("analysis").some(m => m.kieModelId === "gemini-3-8-flash-openai")).toBe(true);
    expect(getModelById("kling-3.0/video")?.enabled).toBe(true);
    expect(getModelById("wan/2-7-videoedit")?.enabled).toBe(true);
  });
});
