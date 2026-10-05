import { resolveGenerationModel } from "./generation-models";

export type MarketGenerationInput = {
  modelId: string; prompt: string; duration?: number; resolution?: string;
  aspectRatio?: string; referenceVideoUrl?: string; generateAudio?: boolean;
  webhookUrl?: string;
};

/** One material-to-endpoint mapping for previews, paid quotes and own-key requests. */
export function buildMarketGenerationPayload(request: MarketGenerationInput, images: string[] = []) {
  const video = request.referenceVideoUrl;
  const entry = resolveGenerationModel(request.modelId, { hasImages: images.length > 0, hasVideo: Boolean(video) });
  const model = entry.kieModelId;
  const editing = model === "wan/2-7-videoedit";
  const duration = request.duration ?? (editing ? 0 : 5);
  const resolution = request.resolution?.toLowerCase() || (entry.resolutionOptions?.includes("720p") ? "720p" : entry.resolutionOptions![0]);
  const aspect = request.aspectRatio && request.aspectRatio !== "auto" ? request.aspectRatio : undefined;
  const fail = () => { throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED"); };
  if (!Number.isSafeInteger(duration) || !entry.resolutionOptions?.includes(resolution) ||
      (editing ? duration !== 0 && (duration < 2 || duration > 10) : !entry.durationOptions?.includes(duration)) ||
      (aspect && !entry.aspectRatios?.includes(aspect)) || images.length > 9) fail();
  const input: { prompt: string; [key: string]: unknown } = { prompt: request.prompt, resolution, nsfw_checker: true };
  if (model.startsWith("bytedance/seedance-2")) {
    Object.assign(input, { duration, aspect_ratio: aspect || "adaptive", generate_audio: request.generateAudio === true,
      ...(images.length ? { reference_image_urls: images } : {}), ...(video ? { reference_video_urls: [video] } : {}) });
  } else if (model.startsWith("wan/2-6-")) {
    if (images.length > 1 || (video && images.length)) fail();
    Object.assign(input, { duration: String(duration), multi_shots: false,
      ...(images.length ? { image_urls: images } : {}), ...(video ? { video_urls: [video] } : {}),
      ...(aspect && !images.length ? { aspect_ratio: aspect } : {}) });
  } else if (model.startsWith("kling-2.6/") || model === "kling-3.0/video") {
    if (video || images.length > (model === "kling-3.0/video" ? 2 : 1)) fail();
    delete input.resolution;
    Object.assign(input, { duration: String(duration), sound: request.generateAudio === true,
      ...(images.length ? { image_urls: images } : { aspect_ratio: aspect || "16:9" }),
      ...(model === "kling-3.0/video" ? { mode: resolution === "1080p" ? "pro" : "std", multi_shots: false } : {}) });
  } else if (model === "wan/2-7-text-to-video") {
    Object.assign(input, { duration, ratio: aspect || "16:9", prompt_extend: true, watermark: false });
  } else if (model === "wan/2-7-image-to-video") {
    if (!images.length || images.length > 2) fail();
    Object.assign(input, { duration, first_frame_url: images[0], ...(images[1] ? { last_frame_url: images[1] } : {}), prompt_extend: true, watermark: false });
  } else if (model === "wan/2-7-r2v") {
    if (!video || images.length + 1 > 5) fail();
    Object.assign(input, { duration, reference_video: [video], ...(images.length ? { reference_image: images } : {}), aspect_ratio: aspect || "16:9", prompt_extend: true, watermark: false });
  } else if (editing) {
    if (!video || images.length > 1) fail();
    Object.assign(input, { duration, video_url: video, ...(images.length ? { reference_image: images[0] } : {}),
      ...(aspect ? { aspect_ratio: aspect } : {}), audio_setting: "auto", prompt_extend: true, watermark: false });
  } else fail();
  return { model, input, ...(request.webhookUrl ? { callBackUrl: request.webhookUrl } : {}) };
}
