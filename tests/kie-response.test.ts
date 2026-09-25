import { describe, expect, it } from "vitest";
import { getKieResponseText } from "@/lib/ai/kie-response";
import { FREE_TRIAL_ANALYSIS_MODEL, FREE_TRIAL_ANALYSIS_PROVIDER } from "@/lib/billing/video-analysis";
import { getModelById, routeModel } from "@/lib/ai/model-registry";

describe("KIE analysis models", () => {
  it("locks the free trial to KIE Gemini 3.8 Flash", () => {
    expect(FREE_TRIAL_ANALYSIS_PROVIDER).toBe("kie");
    expect(FREE_TRIAL_ANALYSIS_MODEL).toBe("gemini-3-8-flash-openai");
    expect(getModelById("analysis-gemini-3-8-flash")?.kieModelId).toBe(FREE_TRIAL_ANALYSIS_MODEL);
  });

  it("uses the current KIE model for automatic analysis", () => {
    expect(routeModel({ category: "analysis", requiredCapabilities: ["text", "image"] })?.id)
      .toBe("analysis-gemini-3-8-flash");
  });
});

describe("KIE response parsing", () => {
  it("reads OpenAI-compatible choices", () => {
    expect(getKieResponseText({ choices: [{ message: { content: "analysis" } }] })).toBe("analysis");
  });

  it("reads Gemini candidates", () => {
    expect(getKieResponseText({ candidates: [{ content: { parts: [{ text: "scene " }, { text: "analysis" }] } }] }))
      .toBe("scene analysis");
  });

  it("does not treat tool-only responses as text", () => {
    expect(getKieResponseText({ candidates: [{ content: { parts: [{ functionCall: { name: "lookup" } }] } }] }))
      .toBeNull();
  });
});
