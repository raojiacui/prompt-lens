export type ModelCategory = "analysis" | "video_generation" | "audio" | "video_edit";
export type ModelProvider = "kie";
export type ModelPriority = "fast" | "balanced" | "best_quality" | "lowest_cost";

export type ModelCapability =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "reference_image"
  | "reference_video"
  | "multi_shot"
  | "native_audio"
  | "first_last_frame"
  | "video_to_video"
  | "generative_edit"
  | "tts"
  | "transcription";

export interface ModelRegistryEntry {
  id: string;
  displayName: string;
  family: string;
  category: ModelCategory;
  provider: ModelProvider;
  kieModelId: string;
  enabled: boolean;
  capabilities: ModelCapability[];
  maxDuration?: number;
  aspectRatios?: string[];
  resolutionOptions?: string[];
  speedLevel: 1 | 2 | 3 | 4 | 5;
  qualityLevel: 1 | 2 | 3 | 4 | 5;
  costLevel: 1 | 2 | 3 | 4 | 5;
  experimental?: boolean;
}

export interface ModelRouteRequest {
  category: ModelCategory;
  requiredCapabilities?: ModelCapability[];
  duration?: number;
  aspectRatio?: string;
  priority?: ModelPriority;
  allowExperimental?: boolean;
}

export const modelRegistry: ModelRegistryEntry[] = [
  {
    id: "analysis-auto-gemini",
    displayName: "Gemini Visual Analysis",
    family: "Gemini",
    category: "analysis",
    provider: "kie",
    kieModelId: "gemini/visual-analysis",
    enabled: true,
    capabilities: ["text", "image", "video"],
    speedLevel: 4,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "analysis-auto-gpt",
    displayName: "GPT Video Understanding",
    family: "OpenAI",
    category: "analysis",
    provider: "kie",
    kieModelId: "openai/video-understanding",
    enabled: true,
    capabilities: ["text", "image", "video"],
    speedLevel: 3,
    qualityLevel: 5,
    costLevel: 4,
  },
  {
    id: "analysis-auto-claude",
    displayName: "Claude Structured Remix",
    family: "Claude",
    category: "analysis",
    provider: "kie",
    kieModelId: "claude/structured-remix",
    enabled: true,
    capabilities: ["text", "image"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "veo-fast",
    displayName: "Veo Fast",
    family: "Veo",
    category: "video_generation",
    provider: "kie",
    kieModelId: "veo3_fast",
    enabled: true,
    capabilities: ["text", "image", "reference_image"],
    maxDuration: 8,
    aspectRatios: ["16:9", "9:16"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 4,
    qualityLevel: 4,
    costLevel: 4,
  },
  {
    id: "seedance-2-balanced",
    displayName: "Seedance 2 Balanced",
    family: "Seedance",
    category: "video_generation",
    provider: "kie",
    kieModelId: "bytedance/seedance-2",
    enabled: true,
    capabilities: ["text", "image", "reference_image", "native_audio"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "seedance-2-mini",
    displayName: "Seedance 2 Mini",
    family: "Seedance",
    category: "video_generation",
    provider: "kie",
    kieModelId: "bytedance/seedance-2-mini",
    enabled: true,
    capabilities: ["text", "image", "reference_image"],
    maxDuration: 15,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["480p", "720p"],
    speedLevel: 5,
    qualityLevel: 3,
    costLevel: 2,
  },
  {
    id: "kling-3-video",
    displayName: "Kling 3 Video",
    family: "Kling",
    category: "video_generation",
    provider: "kie",
    kieModelId: "kling-3.0/video",
    enabled: true,
    capabilities: ["text", "image", "reference_image"],
    maxDuration: 15,
    aspectRatios: ["16:9", "9:16", "1:1"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "wan-video-edit",
    displayName: "Wan Video Edit",
    family: "Wan",
    category: "video_edit",
    provider: "kie",
    kieModelId: "wan/2-7-videoedit",
    enabled: true,
    capabilities: ["video", "reference_video", "video_to_video", "generative_edit"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 2,
    qualityLevel: 4,
    costLevel: 4,
  },
  {
    id: "elevenlabs-tts",
    displayName: "ElevenLabs Voice",
    family: "ElevenLabs",
    category: "audio",
    provider: "kie",
    kieModelId: "elevenlabs/tts",
    enabled: true,
    capabilities: ["text", "audio", "tts"],
    speedLevel: 4,
    qualityLevel: 5,
    costLevel: 4,
  },
  {
    id: "gemini-tts",
    displayName: "Gemini TTS",
    family: "Gemini",
    category: "audio",
    provider: "kie",
    kieModelId: "gemini/tts",
    enabled: true,
    capabilities: ["text", "audio", "tts"],
    speedLevel: 4,
    qualityLevel: 4,
    costLevel: 3,
  },
];

function hasCapabilities(model: ModelRegistryEntry, required: ModelCapability[]) {
  return required.every((capability) => model.capabilities.includes(capability));
}

function priorityScore(model: ModelRegistryEntry, priority: ModelPriority) {
  if (priority === "fast") return model.speedLevel * 3 + model.qualityLevel - model.costLevel;
  if (priority === "best_quality") return model.qualityLevel * 3 + model.speedLevel - model.costLevel;
  if (priority === "lowest_cost") return (6 - model.costLevel) * 3 + model.speedLevel + model.qualityLevel;
  return model.qualityLevel * 2 + model.speedLevel * 1.5 + (6 - model.costLevel) * 1.25;
}

export function listModels(category?: ModelCategory) {
  return modelRegistry.filter((model) => !category || model.category === category);
}

export function getModelById(id: string) {
  return modelRegistry.find((model) => model.id === id || model.kieModelId === id);
}

export function routeModel(request: ModelRouteRequest) {
  const priority = request.priority || "balanced";
  const requiredCapabilities = request.requiredCapabilities || [];
  const candidates = modelRegistry
    .filter((model) => model.category === request.category)
    .filter((model) => model.enabled)
    .filter((model) => request.allowExperimental || !model.experimental)
    .filter((model) => hasCapabilities(model, requiredCapabilities))
    .filter((model) => !request.duration || !model.maxDuration || model.maxDuration >= request.duration)
    .filter((model) => !request.aspectRatio || request.aspectRatio === "auto" || !model.aspectRatios || model.aspectRatios.includes(request.aspectRatio));

  if (!candidates.length) return null;
  return candidates.sort((a, b) => priorityScore(b, priority) - priorityScore(a, priority))[0];
}