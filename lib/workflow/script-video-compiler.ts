import { z } from "zod";
import { getModelById } from "@/lib/ai/model-registry";
import { buildMarketGenerationPayload } from "@/lib/ai/generation-payload";
import { scriptTime, type FullVideoScript } from "./full-video-script";

export const SCRIPT_VIDEO_MODEL = "bytedance/seedance-2-5";
export const SCRIPT_VIDEO_PROMPT_LIMIT = 20480;
export const scriptVideoSettingsSchema = z.object({
  duration: z.number().int().min(4).max(30), resolution: z.enum(["480p", "720p", "1080p"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]), generateAudio: z.boolean(),
}).strict();
export type ScriptVideoSettings = z.infer<typeof scriptVideoSettingsSchema>;

/** Deterministic compilation: no inference, no shortening and no hidden timing changes. */
export function compileScriptVideo(content: FullVideoScript, settings: ScriptVideoSettings, editedPrompt?: string) {
  scriptVideoSettingsSchema.parse(settings);
  const model = getModelById(SCRIPT_VIDEO_MODEL);
  if (!model?.enabled || !model.capabilities.includes("multi_shot") || !model.durationOptions?.includes(settings.duration)) throw new Error("SCRIPT_VIDEO_UNAVAILABLE");
  if (!content.scenes.length || content.scenes.some(s => !s.text.trim() || s.endMs <= s.startMs)) throw new Error("SCRIPT_VIDEO_INCOMPLETE");
  if (content.scenes.some((s, i) => i > 0 && s.startMs < content.scenes[i - 1].endMs)) throw new Error("SCRIPT_VIDEO_INVALID_TIMING");
  if (Math.max(...content.scenes.map(s => s.endMs)) > settings.duration * 1000) throw new Error("SCRIPT_VIDEO_TOO_LONG");
  const prompt = editedPrompt?.trim() ?? [
    `Create one complete ${settings.duration}-second video with the following ordered shots. Preserve the characters and visual style across shots. The timestamps describe the intended editing rhythm; exact cuts are a creative target.`,
    `Title: ${content.title}`, `Story: ${content.summary}`, `Visual style: ${content.globalStyle}`,
    `Characters and continuity: ${content.characters}`, `Continuity notes: ${content.continuityNotes}`,
    ...content.scenes.map(s => `SHOT ${s.sceneIndex} | ${scriptTime(s.startMs)}–${scriptTime(s.endMs)}\n${s.text}`),
    `Deliver a coherent finished video of ${settings.duration} seconds. ${settings.generateAudio ? "Generate synchronized audio consistent with the script." : "Generate without audio."}`,
  ].join("\n\n");
  if (!prompt.trim() || prompt.length > SCRIPT_VIDEO_PROMPT_LIMIT) throw new Error("SCRIPT_VIDEO_PROMPT_TOO_LONG");
  return { settings, prompt, payload: buildMarketGenerationPayload({ modelId: SCRIPT_VIDEO_MODEL, prompt, ...settings }),
    sourceTimeline: content.scenes.map(({ id, sceneIndex, startMs, endMs }) => ({ id, sceneIndex, startMs, endMs })) };
}
