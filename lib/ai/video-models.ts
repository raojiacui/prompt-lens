import { z } from "zod";

type VideoModel = {
  id: string;
  family: string;
  label: string;
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
  maxImages: number;
  minImages: number;
};

const standardRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const seedance2 = { family: "Seedance", durations: [5, 10, 15], resolutions: ["720p", "1080p"], aspectRatios: standardRatios, maxImages: 9, minImages: 0 };
const seedance1 = { family: "Seedance", durations: [5, 10], resolutions: ["720p"], aspectRatios: standardRatios, maxImages: 0, minImages: 0 };
const veo = { family: "Veo", durations: [8], resolutions: ["720p"], aspectRatios: ["16:9", "9:16"], maxImages: 2, minImages: 0 };
export const videoModels: VideoModel[] = [
  { ...seedance2, id: "bytedance/seedance-2", label: "Seedance 2.0" },
  { ...seedance2, id: "bytedance/seedance-2-fast", label: "Seedance 2.0 Fast" },
  { ...seedance2, id: "bytedance/seedance-2-mini", label: "Seedance 2.0 Mini", resolutions: ["480p", "720p"] },
  { ...seedance2, id: "bytedance/seedance-2-5", label: "Seedance 2.5" },
  { ...seedance2, id: "bytedance/seedance-1.5-pro", label: "Seedance 1.5 Pro", durations: [4, 8, 12], maxImages: 2 },
  { ...seedance1, id: "bytedance/v1-pro-text-to-video", label: "Seedance 1.0 Pro · Text to Video" },
  { ...seedance1, id: "bytedance/v1-lite-text-to-video", label: "Seedance 1.0 Lite · Text to Video" },
  { ...seedance1, id: "bytedance/v1-pro-image-to-video", label: "Seedance 1.0 Pro · Image to Video", aspectRatios: ["16:9"], minImages: 1, maxImages: 1 },
  { ...seedance1, id: "bytedance/v1-pro-fast-image-to-video", label: "Seedance 1.0 Pro Fast · Image to Video", aspectRatios: ["16:9"], minImages: 1, maxImages: 1 },
  { ...seedance1, id: "bytedance/v1-lite-image-to-video", label: "Seedance 1.0 Lite · Image to Video", aspectRatios: ["16:9"], minImages: 1, maxImages: 2 },
  { ...veo, id: "veo3_fast", label: "Veo 3.1 Fast" },
  { ...veo, id: "veo3", label: "Veo 3.1 Quality" },
  { id: "wan/2-6-text-to-video", family: "Wan", label: "Wan 2.6", durations: [5, 10, 15], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], maxImages: 0, minImages: 0 },
  { id: "wan/2-6-image-to-video", family: "Wan", label: "Wan 2.6 · Image to Video", durations: [5, 10, 15], resolutions: ["720p", "1080p"], aspectRatios: ["16:9"], maxImages: 1, minImages: 1 },
  { id: "kling-2.6/text-to-video", family: "Kling", label: "Kling 2.6", durations: [5, 10], resolutions: ["1080p"], aspectRatios: ["16:9", "9:16", "1:1"], maxImages: 0, minImages: 0 },
];

export const videoGenerationInput = z.object({
  provider: z.literal("kie").default("kie"),
  model: z.string().min(1, "Please select a model"),
  prompt: z.string().trim().min(1).max(5000),
  duration: z.number().int(),
  resolution: z.string(),
  aspectRatio: z.string(),
  negativePrompt: z.string().trim().max(1000).optional(),
  referenceImageUrls: z.array(z.string().url().refine((url) => url.startsWith("https://"), "HTTPS image URLs required")).max(9).default([]),
}).superRefine((input, ctx) => {
  const model = videoModels.find((item) => item.id === input.model);
  if (!model) {
    ctx.addIssue({ code: "custom", path: ["model"], message: "Unsupported video model" });
    return;
  }
  if (!model.durations.includes(input.duration)) ctx.addIssue({ code: "custom", path: ["duration"], message: "Unsupported duration" });
  if (!model.resolutions.includes(input.resolution)) ctx.addIssue({ code: "custom", path: ["resolution"], message: "Unsupported resolution" });
  if (!model.aspectRatios.includes(input.aspectRatio)) ctx.addIssue({ code: "custom", path: ["aspectRatio"], message: "Unsupported aspect ratio" });
  if (input.referenceImageUrls.length < model.minImages || input.referenceImageUrls.length > model.maxImages) ctx.addIssue({ code: "custom", path: ["referenceImageUrls"], message: "Invalid number of reference images for this model" });
});

export function buildVideoModelPayload(raw: unknown) {
  const input = videoGenerationInput.parse(raw);
  const prompt = input.negativePrompt ? `${input.prompt}\nNegative prompt: ${input.negativePrompt}` : input.prompt;
  const images = input.referenceImageUrls;
  if (isVeoModel(input.model)) {
    return {
      model: input.model,
      prompt,
      aspect_ratio: input.aspectRatio,
      enableFallback: false,
      enableTranslation: true,
      generationType: images.length ? "FIRST_AND_LAST_FRAMES_2_VIDEO" : "TEXT_2_VIDEO",
      ...(images.length ? { imageUrls: images } : {}),
    };
  }
  if (input.model.startsWith("bytedance/seedance-")) {
    const legacy = input.model === "bytedance/seedance-1.5-pro";
    return {
      model: input.model,
      input: {
        prompt,
        duration: input.duration,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        generate_audio: false,
        ...(legacy ? { fixed_lens: false, ...(images.length ? { input_urls: images } : {}) } : {
          web_search: false,
          ...(images.length ? { reference_image_urls: images } : {}),
        }),
      },
    };
  }
  if (input.model.startsWith("bytedance/v1-")) {
    return {
      model: input.model,
      input: {
        prompt,
        duration: String(input.duration),
        resolution: input.resolution,
        ...(images.length ? { image_url: images[0], ...(images[1] ? { end_image_url: images[1] } : {}) } : { aspect_ratio: input.aspectRatio }),
        enable_safety_checker: true,
      },
    };
  }
  return {
    model: input.model,
    input: input.model.startsWith("wan/") ? {
      prompt,
      duration: String(input.duration),
      resolution: input.resolution,
      ...(input.model.endsWith("image-to-video") ? { image_urls: input.referenceImageUrls } : { aspect_ratio: input.aspectRatio }),
      multi_shots: false,
    } : {
      prompt,
      duration: String(input.duration),
      aspect_ratio: input.aspectRatio,
      sound: false,
    },
  };
}

export function isVeoModel(model?: string | null) {
  return model === "veo3" || model === "veo3_fast";
}
