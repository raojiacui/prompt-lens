import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { analyzeSceneBlueprint } from "@/lib/workflow/scene-analysis";

// Explicit opt-in: one paid provider request, synthetic pictures, no account or task writes.
vi.mock("@/lib/byok/kie", () => ({ getUserKieApiKey: async () => null }));

describe.runIf(process.env.KIE_DEEPSEEK_LIVE_TEST === "1")("DeepSeek live image analysis", () => {
  it("returns a real scene blueprint from two synthetic frames through the V2 client", async () => {
    const apiKey = process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY;
    expect(Boolean(apiKey)).toBe(true);
    const ffmpeg = createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg").path;
    const frames = ["red", "blue"].map(color => {
      const result = spawnSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
      expect(result.status).toBe(0);
      return `data:image/jpeg;base64,${result.stdout.toString("base64")}`;
    });
    const started = Date.now();
    const result = await analyzeSceneBlueprint({
      userId: "synthetic-deepseek-smoke", modelMode: "manual", modelId: "analysis-deepseek-v4-1-flash",
      analysisKeySource: "platform", analysisApiKey: apiKey, outputLanguage: "zh",
      scene: { sceneIndex: 1, startTime: 0, endTime: 3, duration: 3, keyframeUrls: frames },
      context: { sceneCount: 1 },
    });
    expect(result.metadata).toMatchObject({ analysisProvider: "kie", analysisModel: "deepseek-v4-1-flash" });
    expect(result.generationPrompt).toMatch(/红/);
    expect(result.generationPrompt).toMatch(/蓝/);
    expect(Object.keys(result.visual).length).toBeGreaterThan(0);
    console.info("DeepSeek synthetic image smoke passed", { elapsedMs: Date.now() - started, imageCount: frames.length, promptLength: result.generationPrompt.length });
  }, 200_000);
});
