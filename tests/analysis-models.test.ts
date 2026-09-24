import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYSIS_MODEL_ID,
  resolveAnalysisModel,
} from "@/lib/ai/analysis-models";

describe("analysis models", () => {
  it("uses OpenRouter Gemini 2.5 Flash for the platform trial", () => {
    expect(resolveAnalysisModel(DEFAULT_ANALYSIS_MODEL_ID)).toMatchObject({
      provider: "openrouter",
      providerModel: "google/gemini-2.5-flash",
      keySource: "platform",
    });
  });

  it("offers KIE Flash and Pro through the user's key", () => {
    expect(resolveAnalysisModel("kie-gemini-2.5-flash")).toMatchObject({
      provider: "kie",
      providerModel: "gemini-2.5-flash",
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
});
