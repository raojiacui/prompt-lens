import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/usage/trial-quota", () => ({ decodeAnalyzeApiKey: (value: string) => value }));
import { analyzeFrames } from "@/lib/ai/analyzer";
import { buildKieAnalysisRequest } from "@/lib/ai/kie-analysis-request";
import { resolveAnalysisModel, DEFAULT_ANALYSIS_MODEL_ID, resolvePlatformAnalysisApiKey } from "@/lib/ai/analysis-models";
import { requestKieChatCompletion } from "@/lib/ai/kie-chat-client";

// Explicit opt-in: synthetic inline JPEGs only; consumes KIE credits.
describe.runIf(process.env.DEEPSEEK_LIVE_TEST === "1")("live DeepSeek inline image analysis", () => {
  it("recognizes two images by position, then produces the normal multi-frame analysis", async () => {
    const apiKey = resolvePlatformAnalysisApiKey();
    if (!apiKey) throw new Error("KIE test key required");
    const require = createRequire(import.meta.url);
    const sharp = createRequire(require.resolve("next/package.json"))("sharp");
    const frames = await Promise.all(["#ff0000", "#0000ff"].map(async (background) => {
      const image = await sharp({ create: { width: 128, height: 128, channels: 3, background } }).jpeg().toBuffer();
      return `data:image/jpeg;base64,${image.toString("base64")}`;
    }));
    const selected = resolveAnalysisModel(DEFAULT_ANALYSIS_MODEL_ID)!;
    const { path, payload } = buildKieAnalysisRequest(selected.providerModel, frames,
      "Identify the solid color of each image in input order. Reply only with the two English color names, separated by a comma.");
    const base = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
    const started = Date.now();
    const colors = await requestKieChatCompletion({ url: `${base}${path}`, apiKey, payload });
    expect(colors.toLowerCase()).toMatch(/red[\s\S]*blue/);
    console.log("DeepSeek recognized red then blue from two inline JPEGs.", { elapsedMs: Date.now() - started });
    const result = await analyzeFrames({ userId: "synthetic-model-smoke", provider: selected.provider,
      model: selected.providerModel, apiKeyOverride: apiKey, frames: [...frames, ...frames, ...frames, ...frames], mode: "batch", outputLanguage: "zh" });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.prompt!.length).toBeGreaterThan(100);
    expect(result.corePrompt).toBeTruthy();
    console.log("DeepSeek normal analysis pipeline returned a prompt and corePrompt from eight synthetic frames.");
  }, 600_000);
});
