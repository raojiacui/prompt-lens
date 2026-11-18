import type { ModelRegistryEntry } from "./model-registry";

const ratios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const baseVideoProfile = { category: "video_generation", provider: "infistar", enabled: true,
  capabilities: ["text", "image", "reference_image"], maxDuration: 15,
  durationOptions: Array.from({ length: 11 }, (_, i) => i + 5), aspectRatios: ratios,
  resolutionOptions: ["720p"], speedLevel: 4, qualityLevel: 4, costLevel: 2,
} satisfies Omit<ModelRegistryEntry, "id" | "displayName" | "family" | "providerModelId">;

/**
 * API IDs checked against Infistar's public model square (2026-11-18):
 * https://infistar.cc/pricing
 *
 * Doubao Seedance and Jimeng are DISTINCT video model families and MUST NOT be
 * merged into a single "即梦 Seedance" product in the generation selector.
 * Keep providerModelId unchanged: these are the actual API request model IDs.
 * A user's key/group and accepted options still determine runtime availability.
 */
export const infistarModels: ModelRegistryEntry[] = [
  { ...baseVideoProfile, id: "infistar-seedance-2-mini", displayName: "豆包 Seedance 2.0 Mini", family: "Doubao Seedance", providerModelId: "doubao-seedance-2.0-mini" },
  ...([
    ["jimeng-video-3.0", "即梦 视频 3.0", "Jimeng", 2],
    ["jimeng-video-3.0-pro", "即梦 视频 3.0 Pro", "Jimeng", 5],
    ["kling-v3", "可灵 Kling 3", "Kling", 3],
    ["kling-v3-omni", "可灵 Kling 3 Omni", "Kling", 3],
    ["kling-3.0-turbo", "可灵 Kling 3 Turbo", "Kling", 4],
  ] as const).map(([id, displayName, family, costLevel]): ModelRegistryEntry => ({
    ...baseVideoProfile, id: `infistar-${id}`, displayName, family, providerModelId: id, costLevel,
    resolutionOptions: id === "jimeng-video-3.0-pro" ? ["1080p"] : ["720p", "1080p"], durationOptions: [5, 10], maxDuration: 10,
  })),
  { ...baseVideoProfile, id: "infistar-seedance-2-fast", displayName: "豆包 Seedance 2.0 Fast", family: "Doubao Seedance", providerModelId: "doubao-seedance-2-0-fast-260128", speedLevel: 5, costLevel: 3 },
  { ...baseVideoProfile, id: "infistar-seedance-2", displayName: "豆包 Seedance 2.0", family: "Doubao Seedance", providerModelId: "doubao-seedance-2-0-260128", resolutionOptions: ["480p", "720p", "1080p"], qualityLevel: 5, costLevel: 4 },
  { id: "infistar-kling-o1", displayName: "可灵 Kling O1", family: "Kling", providerModelId: "kling-video-o1", category: "video_generation", provider: "infistar", enabled: true,
    capabilities: ["text", "image", "reference_image"], maxDuration: 10, durationOptions: [5, 10], aspectRatios: ["16:9", "9:16", "1:1"], resolutionOptions: ["720p", "1080p"], speedLevel: 3, qualityLevel: 5, costLevel: 4 },
];
