import { afterEach, expect, it, vi } from "vitest";
import { createKieVeoGeneration, getKieVeoGenerationStatus } from "@/lib/reference-video/kie-veo";
import { generateVideoWithKIE, fetchKIETaskResult } from "@/lib/ai/adapters/kie-video";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("never implicitly uses the platform key for generation or polling", async () => {
  vi.stubEnv("KIE_API_KEY", "platform-secret-that-must-not-be-used");
  vi.stubEnv("KIE_AI_API_KEY", "platform-secret-that-must-not-be-used");
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  await expect(createKieVeoGeneration({ prompt: "test", model: "veo3_fast" })).rejects.toThrow("KIE_ACCESS_REQUIRED");
  await expect(getKieVeoGenerationStatus("task", "veo3_fast")).rejects.toThrow("KIE_ACCESS_REQUIRED");
  await expect(generateVideoWithKIE({ prompt: "test", modelId: "veo3_fast" })).rejects.toThrow("KIE_ACCESS_REQUIRED");
  await expect(fetchKIETaskResult("task", "veo3_fast")).rejects.toThrow("KIE_ACCESS_REQUIRED");
  expect(fetchSpy).not.toHaveBeenCalled();
});
