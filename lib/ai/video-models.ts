import { z } from "zod";

// Explicit choices from the V2 registry, limited to adapters supported by V1.
export const videoModels = [
  { id: "wan/2-6-text-to-video", label: "Wan 2.6", durations: [5, 10, 15], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], maxImages: 0, minImages: 0 },
  { id: "wan/2-6-image-to-video", label: "Wan 2.6 · Image to Video", durations: [5, 10, 15], resolutions: ["720p", "1080p"], aspectRatios: ["16:9"], maxImages: 1, minImages: 1 },
  { id: "kling-2.6/text-to-video", label: "Kling 2.6", durations: [5, 10], resolutions: ["1080p"], aspectRatios: ["16:9", "9:16", "1:1"], maxImages: 0, minImages: 0 },
];

export const videoGenerationInput = z.object({
  provider: z.literal("kie").default("kie"),
  model: z.string().min(1, "Please select a model"),
  prompt: z.string().trim().min(1).max(5000),
  duration: z.number().int(),
  resolution: z.string(),
  aspectRatio: z.string(),
  negativePrompt: z.string().trim().max(1000).optional(),
  referenceImageUrls: z.array(z.string().url().refine((url) => url.startsWith("https://"), "HTTPS image URLs required")).max(1).default([]),
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
