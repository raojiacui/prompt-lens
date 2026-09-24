import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYSIS_MODEL_ID,
  resolvePlatformAnalysisApiKey,
  resolveAnalysisModel,
  getKieAnalysisPath,
} from "@/lib/ai/analysis-models";

describe("analysis models", () => {
  it("uses the supported KIE Flash model for the platform trial", () => {
    expect(resolveAnalysisModel(DEFAULT_ANALYSIS_MODEL_ID)).toMatchObject({
      provider: "kie",
      providerModel: "gemini-3-5-flash-thinking",
      keySource: "platform",
    });
  });

  it("loads the platform KIE key from server environment variables", () => {
    expect(resolvePlatformAnalysisApiKey({ KIE_API_KEY: "platform-key" })).toBe("platform-key");
    expect(resolvePlatformAnalysisApiKey({ KIE_AI_API_KEY: "preferred-key", KIE_API_KEY: "fallback-key" })).toBe("preferred-key");
  });

  it("offers KIE Flash and Pro through the user's key", () => {
    expect(resolveAnalysisModel("kie-gemini-3.5-flash")).toMatchObject({
      provider: "kie",
      providerModel: "gemini-3-5-flash-thinking",
      keySource: "user",
    });
    expect(resolveAnalysisModel("kie-gemini-2.5-pro")).toMatchObject({
      provider: "kie",
      providerModel: "gemini-2.5-pro",
      keySource: "user",
    });
  });

  it("rejects unknown model ids", () => {
    expect(resolveAnalysisModel("other-model")).toBeNull();
  });

  it("migrates old clients without changing who pays", () => {
    expect(resolveAnalysisModel("platform-gemini-2.5-flash")).toEqual(resolveAnalysisModel(DEFAULT_ANALYSIS_MODEL_ID));
    expect(resolveAnalysisModel("kie-gemini-2.5-flash")).toEqual(resolveAnalysisModel("kie-gemini-3.5-flash"));
  });

  it("maps request models to their explicit KIE channels", () => {
    expect(getKieAnalysisPath("gemini-3-5-flash-thinking")).toBe("/gemini-3-5-flash-openai/v1/chat/completions");
    expect(getKieAnalysisPath("gemini-2.5-pro")).toBe("/gemini-2.5-pro/v1/chat/completions");
    expect(() => getKieAnalysisPath("gemini-2.5-flash")).toThrow("Unsupported");
  });
});
