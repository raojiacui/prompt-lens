import { estimateGeneration } from "./pricing-v6";
import { getModelById } from "@/lib/ai/model-registry";

export function generationCreditPreview(input: {
  model?: string; resolution: string; duration: number; quantity: number;
  hasImages: boolean; hasVideo: boolean; referenceSeconds?: number; imageCount?: number;
}): { state: "priced"; total: number; perVideo: number } | { state: "pending" | "unavailable" } {
  if (input.hasVideo && input.referenceSeconds === undefined) return { state: "pending" };
  const selected = input.model || (input.hasVideo ? "bytedance/seedance-2-fast" : input.hasImages ? "wan/2-6-image-to-video" : "wan/2-6-text-to-video");
  const model = getModelById(selected);
  if (!model?.enabled || !["video_generation", "video_edit"].includes(model.category)) return { state: "unavailable" };
  const modelId = model.kieModelId;
  if (["veo3", "veo3_fast", "veo3_lite"].includes(modelId)) {
    const images = input.imageCount ?? (input.hasImages ? 1 : 0);
    if (input.hasVideo || images > (modelId === "veo3" ? 2 : 3) || (images > 2 && input.duration !== 8)) return { state: "unavailable" };
  }
  try {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 4) return { state: "unavailable" };
    const quote = estimateGeneration({ modelId, resolution: input.resolution.toLowerCase(), durationSeconds: input.duration || input.referenceSeconds || 0, referenceVideoSeconds: input.hasVideo ? input.referenceSeconds : undefined, audio: false });
    return { state: "priced", total: quote.credits * input.quantity, perVideo: quote.credits };
  } catch { return { state: "unavailable" }; }
}
