import { describe, expect, it } from "vitest";
import { getModelById, listModels, resolveModelSelection } from "@/lib/ai/model-registry";
import { buildKIEJobPayload } from "@/lib/ai/adapters/kie-video";

describe("Removed Sora generation models", () => {
  it("does not offer Sora in the catalog", () => {
    expect(listModels("video_generation").some(model => model.family === "Sora")).toBe(false);
  });
  it.each(["sora-2-text-video", "sora-2-image-video", "sora-2/text-to-video", "sora-2/image-to-video"])("rejects manual selection of %s", (modelId) => {
    expect(getModelById(modelId)).toBeUndefined();
    expect(() => resolveModelSelection("video_generation", { mode: "manual", modelId })).toThrow("not available");
  });
  it.each(["sora-2/text-to-video", "sora-2/image-to-video"])("rejects new-task payloads for %s", (modelId) => {
    expect(() => buildKIEJobPayload({ modelId, prompt: "test" }, ["https://example.com/image.jpg"])).toThrow("MODEL_UNAVAILABLE");
  });
});
