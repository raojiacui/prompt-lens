import { getModelById, modelRegistry } from "./model-registry";

export type GenerationMaterials = { hasImages: boolean; hasVideo: boolean };

export function generationChoiceId(id: string) {
  const providerId = getModelById(id)?.kieModelId || id;
  if (providerId.startsWith("wan/2-6-")) return "wan/2-6-text-to-video";
  if (providerId.startsWith("wan/2-7-") && providerId !== "wan/2-7-videoedit") return "wan/2-7-text-to-video";
  if (providerId.startsWith("kling-2.6/")) return "kling-2.6/text-to-video";
  return providerId;
}

export function generationChoices() {
  return modelRegistry.filter(m => m.enabled && ["video_generation", "video_edit"].includes(m.category) && generationChoiceId(m.kieModelId) === m.kieModelId);
}

export function resolveGenerationModel(id: string, materials: GenerationMaterials) {
  const choice = generationChoiceId(id);
  let providerId = choice;
  if (choice === "wan/2-6-text-to-video") providerId = materials.hasVideo ? "wan/2-6-video-to-video" : materials.hasImages ? "wan/2-6-image-to-video" : choice;
  if (choice === "wan/2-7-text-to-video") providerId = materials.hasVideo ? "wan/2-7-r2v" : materials.hasImages ? "wan/2-7-image-to-video" : choice;
  if (choice === "kling-2.6/text-to-video" && materials.hasImages) providerId = "kling-2.6/image-to-video";
  const model = getModelById(providerId);
  if (!model?.enabled || !["video_generation", "video_edit"].includes(model.category)) throw new Error("MODEL_UNAVAILABLE");
  if (materials.hasVideo ? !model.capabilities.includes("reference_video") : materials.hasImages ? !model.capabilities.includes("reference_image") : !model.capabilities.includes("text")) throw new Error("GENERATION_MATERIALS_UNSUPPORTED");
  return model;
}

export function generationDisplayName(id: string) {
  const choice = generationChoiceId(id);
  if (choice === "wan/2-6-text-to-video") return "Wan 2.6";
  if (choice === "wan/2-7-text-to-video") return "Wan 2.7";
  if (choice === "kling-2.6/text-to-video") return "Kling 2.6";
  return getModelById(choice)?.displayName || id;
}
