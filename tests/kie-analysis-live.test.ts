import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: { userApiKeys: { findMany } } } }));
vi.mock("@/lib/usage/trial-quota", () => ({ decodeAnalyzeApiKey: (value: string) => value }));

import { analyzeFrames } from "@/lib/ai/analyzer";
import { DEFAULT_ANALYSIS_MODEL_ID, resolveAnalysisModel, resolvePlatformAnalysisApiKey } from "@/lib/ai/analysis-models";

// Explicit opt-in: these smoke tests call KIE and consume a small amount of credit.
describe.runIf(process.env.KIE_LIVE_TEST === "1")("live KIE analysis", () => {
  const publicFrame = "https://file.aiquickdraw.com/custom-page/akr/section-images/1759055072437dqlsclj2.png";

  it.each(["platform", "user"] as const)("analyzes image frames using the %s key path", async (keySource) => {
    const key = resolvePlatformAnalysisApiKey();
    expect(key).toBeTruthy();
    const model = resolveAnalysisModel(keySource === "platform" ? DEFAULT_ANALYSIS_MODEL_ID : "kie-gemini-3.5-flash")!;
    findMany.mockReset();
    findMany.mockResolvedValue(keySource === "user" ? [{ apiKey: key }] : []);

    const result = await analyzeFrames({
      userId: "live-smoke-test",
      provider: model.provider,
      model: model.providerModel,
      apiKeyOverride: keySource === "platform" ? key! : undefined,
      frames: [publicFrame, publicFrame],
      mode: "batch",
      outputLanguage: "zh",
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.prompt!.length).toBeGreaterThan(100);
    expect(result.corePrompt).toBeTruthy();
    expect(findMany).toHaveBeenCalledTimes(keySource === "user" ? 1 : 0);
  }, 200_000);
});
