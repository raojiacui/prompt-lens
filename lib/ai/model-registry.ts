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

export type ModelSelectionMode = "auto" | "manual";

export interface ModelSelectionInput {
  mode?: ModelSelectionMode;
  modelId?: string;
  priority?: ModelPriority;
  allowExperimental?: boolean;
}

export const modelRegistry: ModelRegistryEntry[] = [
  {
    id: "analysis-gemini-2-5-flash",
    displayName: "Gemini 2.5 Flash",
    family: "Gemini",
    category: "analysis",
    provider: "kie",
    kieModelId: "gemini-2.5-flash",
    enabled: true,
    capabilities: ["text", "image", "video"],
    speedLevel: 5,
    qualityLevel: 4,
    costLevel: 2,
  },
  {
    id: "analysis-gemini-2-5-pro",
    displayName: "Gemini 2.5 Pro",
    family: "Gemini",
    category: "analysis",
    provider: "kie",
    kieModelId: "gemini-2.5-pro",
    enabled: true,
    capabilities: ["text", "image", "video"],
    speedLevel: 3,
    qualityLevel: 5,
    costLevel: 4,
  },
  {
    id: "analysis-gpt-video",
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
    id: "analysis-claude-remix",
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
    id: "sora-2-text-video",
    displayName: "Sora 2 Text to Video",
    family: "Sora",
    category: "video_generation",
    provider: "kie",
    kieModelId: "sora-2/text-to-video",
    enabled: true,
    capabilities: ["text", "native_audio"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 5,
    costLevel: 5,
  },
  {
    id: "sora-2-image-video",
    displayName: "Sora 2 Image to Video",
    family: "Sora",
    category: "video_generation",
    provider: "kie",
    kieModelId: "sora-2/image-to-video",
    enabled: true,
    capabilities: ["text", "image", "reference_image", "native_audio"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 5,
    costLevel: 5,
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
    capabilities: ["text", "image", "reference_image", "reference_video", "native_audio", "first_last_frame"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "seedance-2-fast",
    displayName: "Seedance 2 Fast",
    family: "Seedance",
    category: "video_generation",
    provider: "kie",
    kieModelId: "bytedance/seedance-2-fast",
    enabled: true,
    capabilities: ["text", "image", "reference_image", "reference_video", "native_audio", "first_last_frame"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 5,
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
    id: "kling-2-6-video",
    displayName: "Kling 2.6 Video",
    family: "Kling",
    category: "video_generation",
    provider: "kie",
    kieModelId: "kling-2.6/text-to-video",
    enabled: true,
    capabilities: ["text"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "wan-2-6-text-video",
    displayName: "Wan 2.6 Text to Video",
    family: "Wan",
    category: "video_generation",
    provider: "kie",
    kieModelId: "wan/2-6-text-to-video",
    enabled: true,
    capabilities: ["text"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p"],
    speedLevel: 4,
    qualityLevel: 3,
    costLevel: 2,
  },
  {
    id: "wan-2-6-image-video",
    displayName: "Wan 2.6 Image to Video",
    family: "Wan",
    category: "video_generation",
    provider: "kie",
    kieModelId: "wan/2-6-image-to-video",
    enabled: true,
    capabilities: ["text", "image", "reference_image"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p"],
    speedLevel: 4,
    qualityLevel: 3,
    costLevel: 2,
  },
  {
    id: "grok-imagine-text-video",
    displayName: "Grok Imagine Text to Video",
    family: "Grok",
    category: "video_generation",
    provider: "kie",
    kieModelId: "grok-imagine/text-to-video",
    enabled: true,
    capabilities: ["text"],
    maxDuration: 10,
    aspectRatios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    resolutionOptions: ["720p"],
    speedLevel: 4,
    qualityLevel: 3,
    costLevel: 3,
  },
  {
    id: "wan-video-edit",
    displayName: "Wan 2.7 Video Edit",
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
    id: "wan-2-6-video-to-video",
    displayName: "Wan 2.6 Video to Video",
    family: "Wan",
    category: "video_edit",
    provider: "kie",
    kieModelId: "wan/2-6-video-to-video",
    enabled: true,
    capabilities: ["video", "reference_video", "video_to_video", "generative_edit"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 3,
  },
  {
    id: "kling-omni-transform",
    displayName: "Kling Omni Transformation",
    family: "Kling",
    category: "video_edit",
    provider: "kie",
    kieModelId: "kling-omni/transformation",
    enabled: true,
    capabilities: ["video", "reference_video", "video_to_video", "generative_edit"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    resolutionOptions: ["720p", "1080p"],
    speedLevel: 3,
    qualityLevel: 4,
    costLevel: 4,
  },
  {
    id: "happyhorse-video-edit",
    displayName: "HappyHorse Video Edit",
    family: "HappyHorse",
    category: "video_edit",
    provider: "kie",
    kieModelId: "happyhorse/video-edit",
    enabled: true,
    capabilities: ["video", "reference_video", "video_to_video", "generative_edit"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    resolutionOptions: ["720p"],
    speedLevel: 3,
    qualityLevel: 3,
    costLevel: 3,
    experimental: true,
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
    id: "elevenlabs-speech-to-text",
    displayName: "ElevenLabs Speech to Text",
    family: "ElevenLabs",
    category: "audio",
    provider: "kie",
    kieModelId: "elevenlabs/speech-to-text",
    enabled: true,
    capabilities: ["audio", "transcription"],
    speedLevel: 4,
    qualityLevel: 4,
    costLevel: 3,
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
  {
    id: "suno-voice",
    displayName: "Suno Voice",
    family: "Suno",
    category: "audio",
    provider: "kie",
    kieModelId: "suno/voice",
    enabled: true,
    capabilities: ["text", "audio", "tts"],
    speedLevel: 3,
    qualityLevel: 3,
    costLevel: 3,
    experimental: true,
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

export function resolveModelSelection(
  category: ModelCategory,
  selection: ModelSelectionInput | undefined,
  routeRequest: Omit<ModelRouteRequest, "category" | "priority" | "allowExperimental"> = {},
) {
  const priority = selection?.priority || "balanced";
  if (selection?.mode === "manual" && selection.modelId) {
    const model = getModelById(selection.modelId);
    if (!model || model.category !== category) throw new Error(`Selected model is not available for ${category}`);
    if (!model.enabled) throw new Error(`Selected model ${model.displayName} is disabled`);
    return { model, mode: "manual" as const, priority };
  }

  const model = routeModel({ category, priority, allowExperimental: selection?.allowExperimental, ...routeRequest });
  if (!model) throw new Error(`No available model for ${category}`);
  return { model, mode: "auto" as const, priority };
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