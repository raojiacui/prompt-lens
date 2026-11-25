import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { compileScriptVideo, SCRIPT_VIDEO_MODEL } from "@/lib/workflow/script-video-compiler";
import { generationChoices } from "@/lib/ai/generation-models";
import { buildCommercialGenerationPayload } from "@/lib/billing/commercial-generation";
import { buildMarketGenerationPayload } from "@/lib/ai/generation-payload";
import type { FullVideoScript } from "@/lib/workflow/full-video-script";
const script: FullVideoScript = { title: "湖面故事", summary: "人物乘舟，随后走向雪原", globalStyle: "写实电影", characters: "同一白衣人物", continuityNotes: "保持人物外观一致", scenes: [
  { id: randomUUID(), sceneIndex: 1, startMs: 250, endMs: 9000, text: "人物乘舟，镜头缓慢平移" },
  { id: randomUUID(), sceneIndex: 2, startMs: 11000, endMs: 30000, text: "人物走向雪原，远景，冷色光" },
] };
const settings = { duration: 30, resolution: "720p" as const, aspectRatio: "16:9" as const, generateAudio: true };
describe("Seedance 2.5 full-script compiler", () => {
  it("retains every shot, real time boundaries and continuity in the actual 30-second payload", () => {
    const compiled = compileScriptVideo(script, settings);
    expect(compiled.payload).toEqual({ model: SCRIPT_VIDEO_MODEL, input: { prompt: compiled.prompt, nsfw_checker: true, duration: 30, resolution: "720p", aspect_ratio: "16:9", generate_audio: true, output_format: "mp4" } });
    expect(compiled.prompt).toContain("00:11.000–00:30.000");
    expect(compiled.prompt).toContain(script.scenes[0].text);
    expect(compiled.prompt).toContain(script.characters);
    expect(compiled.sourceTimeline[1].id).toBe(script.scenes[1].id);
    expect(compiled.payload.input).not.toHaveProperty("omni_reference_task_type");
  });
  it("rejects overflow rather than clipping scenes, and never shortens an oversized prompt", () => {
    expect(() => compileScriptVideo(script, { ...settings, duration: 15 })).toThrow("SCRIPT_VIDEO_TOO_LONG");
    expect(() => compileScriptVideo({ ...script, summary: "长".repeat(20480) }, settings)).toThrow("SCRIPT_VIDEO_PROMPT_TOO_LONG");
    expect(() => compileScriptVideo(script, settings, "长".repeat(20481))).toThrow("SCRIPT_VIDEO_PROMPT_TOO_LONG");
    expect(script.scenes[1].endMs).toBe(30000);
  });
  it("allows a reviewed manual prompt while preserving source timing and model parameters", () => {
    const result = compileScriptVideo(script, settings, "根据完整故事创作两个连续镜头，保持人物一致。");
    expect(result.payload.input.prompt).toBe("根据完整故事创作两个连续镜头，保持人物一致。");
    expect(result.sourceTimeline).toHaveLength(2);
    expect(() => compileScriptVideo({ ...script, scenes: [] }, settings)).toThrow("SCRIPT_VIDEO_INCOMPLETE");
    expect(() => compileScriptVideo({ ...script, scenes: [...script.scenes].reverse() }, settings)).toThrow("SCRIPT_VIDEO_INVALID_TIMING");
  });
  it("exposes the model only for BYOK and rejects platform billing and unsupported material routes", () => {
    expect(generationChoices("kie").some(m => m.providerModelId === SCRIPT_VIDEO_MODEL)).toBe(false);
    expect(generationChoices("kie", "byok").some(m => m.providerModelId === SCRIPT_VIDEO_MODEL)).toBe(true);
    expect(() => buildCommercialGenerationPayload({ model: SCRIPT_VIDEO_MODEL, userPrompt: "A coherent story", duration: 30, quality: "720p" })).toThrow("BYOK_ONLY_MODEL");
    expect(() => buildMarketGenerationPayload({ modelId: SCRIPT_VIDEO_MODEL, prompt: "story", ...settings }, ["image"])).toThrow("GENERATION_MATERIALS_UNSUPPORTED");
    expect(() => buildMarketGenerationPayload({ modelId: SCRIPT_VIDEO_MODEL, prompt: "story", ...settings, duration: -1 })).toThrow();
  });
});
