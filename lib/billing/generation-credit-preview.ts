import { estimateGeneration } from "./pricing-v6";
import { resolveGenerationModel } from "@/lib/ai/generation-models";
import { buildMarketGenerationPayload } from "@/lib/ai/generation-payload";

export function generationCreditPreview(input: {
  model?: string; resolution: string; duration: number; quantity: number;
  hasImages: boolean; hasVideo: boolean; referenceSeconds?: number; imageCount?: number;
}): { state: "priced"; total: number; perVideo: number } | { state: "pending" | "unavailable" } {
  if (input.hasVideo && input.referenceSeconds === undefined) return { state: "pending" };
  const selected = input.model || (input.hasVideo ? "bytedance/seedance-2-fast" : input.hasImages ? "wan/2-6-image-to-video" : "wan/2-6-text-to-video");
  let model;
  try { model = resolveGenerationModel(selected, input); }
  catch { return { state: "unavailable" }; }
  const modelId = model.kieModelId;
  if (input.hasVideo && modelId.startsWith("bytedance/seedance-2") && (input.referenceSeconds! < 2 || input.referenceSeconds! > 15)) return { state: "unavailable" };
  if (modelId === "wan/2-7-videoedit" && (input.referenceSeconds! < 2 || input.referenceSeconds! > 10 || (input.duration !== 0 && input.duration > input.referenceSeconds!))) return { state: "unavailable" };
  if (["veo3", "veo3_fast", "veo3_lite"].includes(modelId)) {
    const images = input.imageCount ?? (input.hasImages ? 1 : 0);
    if (input.hasVideo || images > (modelId === "veo3" ? 2 : 3) || (images > 2 && input.duration !== 8)) return { state: "unavailable" };
  }
  try {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 4) return { state: "unavailable" };
    if (!modelId.startsWith("veo3")) buildMarketGenerationPayload({ modelId, prompt: "preview", duration: input.duration, resolution: input.resolution, referenceVideoUrl: input.hasVideo ? "preview-video" : undefined }, Array.from({ length: input.imageCount ?? (input.hasImages ? 1 : 0) }, () => "preview-image"));
    const quote = estimateGeneration({ modelId, resolution: input.resolution.toLowerCase(), durationSeconds: input.duration || input.referenceSeconds || 0, referenceVideoSeconds: input.hasVideo ? input.referenceSeconds : undefined, audio: false });
    return { state: "priced", total: quote.credits * input.quantity, perVideo: quote.credits };
  } catch { return { state: "unavailable" }; }
}
