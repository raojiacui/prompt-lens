import type { ModelRegistryEntry } from "./model-registry";

const ratios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const seedance = { category: "video_generation", provider: "infistar", enabled: true,
  capabilities: ["text", "image", "reference_image"], maxDuration: 15,
  durationOptions: Array.from({ length: 11 }, (_, i) => i + 5), aspectRatios: ratios,
  resolutionOptions: ["720p"], speedLevel: 4, qualityLevel: 4, costLevel: 2,
} satisfies Omit<ModelRegistryEntry, "id" | "displayName" | "family" | "providerModelId">;

/** Exact IDs observed through /v1/models; separate from KIE's catalog and prices. */
export const infistarModels: ModelRegistryEntry[] = [
  { ...seedance, id: "infistar-seedance-2-mini", displayName: "即梦 Seedance 2.0 Mini", family: "Seedance", providerModelId: "doubao-seedance-2.0-mini" },
  ...([
    ["jimeng-video-3.0", "即梦 3.0", "Jimeng", 2],
    ["jimeng-video-3.0-pro", "即梦 3.0 Pro", "Jimeng", 5],
    ["kling-v3", "可灵 Kling 3", "Kling", 3],
    ["kling-v3-omni", "可灵 Kling 3 Omni", "Kling", 3],
    ["kling-3.0-turbo", "可灵 Kling 3 Turbo", "Kling", 4],
    ["kling-v2-6", "可灵 Kling 2.6", "Kling", 3],
    ["MiniMax-H3", "MiniMax H3", "MiniMax", 2],
  ] as const).map(([id, displayName, family, costLevel]): ModelRegistryEntry => ({
    ...seedance, id: `infistar-${id}`, displayName, family, providerModelId: id, costLevel,
    resolutionOptions: id === "MiniMax-H3" ? ["1080p"] : ["720p", "1080p"], durationOptions: [5, 10], maxDuration: 10,
    capabilities: id === "MiniMax-H3" ? ["text", "image", "reference_image", "video", "reference_video", "video_to_video", "generative_edit"] : ["text", "image", "reference_image"],
  })),
  { ...seedance, id: "infistar-seedance-2-fast", displayName: "即梦 Seedance 2.0 Fast", family: "Seedance", providerModelId: "doubao-seedance-2-0-fast-260128", speedLevel: 5, costLevel: 3 },
  { ...seedance, id: "infistar-seedance-2", displayName: "即梦 Seedance 2.0", family: "Seedance", providerModelId: "doubao-seedance-2-0-260128", resolutionOptions: ["480p", "720p", "1080p"], qualityLevel: 5, costLevel: 4 },
  { id: "infistar-kling-o1", displayName: "可灵 Kling O1", family: "Kling", providerModelId: "kling-video-o1", category: "video_generation", provider: "infistar", enabled: true,
    capabilities: ["text", "image", "reference_image"], maxDuration: 10, durationOptions: [5, 10], aspectRatios: ["16:9", "9:16", "1:1"], resolutionOptions: ["720p", "1080p"], speedLevel: 3, qualityLevel: 5, costLevel: 4 },
  ...(["t2v", "i2v"] as const).map((mode): ModelRegistryEntry => ({
    id: `infistar-wan-2-7-${mode}`, displayName: "Wan 2.7", family: "Wan", providerModelId: `wan2.7-${mode}`, category: "video_generation", provider: "infistar", enabled: true,
    capabilities: mode === "i2v" ? ["image", "reference_image"] : ["text"], maxDuration: 15, durationOptions: Array.from({ length: 14 }, (_, i) => i + 2), aspectRatios: ratios, resolutionOptions: ["720p", "1080p"], speedLevel: 4, qualityLevel: 4, costLevel: 2,
  })),
];
