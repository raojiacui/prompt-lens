/**
 * KIE Video Generation Adapter
 *
 * Veo models use: POST /api/v1/veo/generate + GET /api/v1/veo/record-info
 * KIE Market models use: POST /api/v1/jobs/createTask + GET /api/v1/jobs/recordInfo
 */

import { uploadToR2 } from "@/lib/cloudflare/r2";

export type VideoGenerationInput = {
  prompt: string;
  modelId: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  cfgScale?: number;
  generateAudio?: boolean;
  mode?: string;
  seed?: number;
  cameraFixed?: boolean;
  image?: string;
  webhookUrl?: string;
};

const KIE_BASE_URL = process.env.KIE_API_BASE_URL || "https://api.kie.ai";

type KIEJobState = "waiting" | "queuing" | "generating" | "success" | "fail";

interface KIECreateTaskResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
  };
}

interface KIERecordInfoResponse {
  code: number;
  message: string;
  data: {
    taskId: string;
    model: string;
    state: KIEJobState;
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
    costTime?: number;
    progress?: number;
  };
}

interface KIEVideoResult {
  videoUrl: string;
  externalId: string;
}

interface KIEVeoRecordInfoResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    successFlag: 0 | 1 | 2 | 3;
    response?: {
      resultUrls?: string[];
      originUrls?: string[];
      fullResultUrls?: string[];
      resolution?: string;
    };
    errorMessage?: string;
  };
}

function getKIEApiKey() {
  const apiKey = process.env.KIE_API_KEY || process.env.KIE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("KIE_API_KEY or KIE_AI_API_KEY is not configured");
  }
  return apiKey;
}

export function isKIEVeoModel(modelId: string): boolean {
  return modelId.startsWith("veo3_");
}

function isKIESeedance2Model(modelId: string): boolean {
  return modelId.startsWith("bytedance/seedance-2");
}

function isKIESoraModel(modelId: string): boolean {
  return modelId.startsWith("sora-2/");
}

function isKIEImageModel(
  input: VideoGenerationInput,
  imageUrls: string[],
): boolean {
  return Boolean(
    input.image || imageUrls.length || input.modelId.includes("image-to-video"),
  );
}

function isKIEWanVideoEditModel(modelId: string): boolean {
  return modelId === "wan/2-7-videoedit";
}

export function normalizeKIEVeoAspectRatio(
  aspectRatio?: string,
): "16:9" | "9:16" {
  return aspectRatio === "9:16" ? "9:16" : "16:9";
}

function normalizeKIEAspectRatio(aspectRatio?: string): string | undefined {
  if (!aspectRatio || aspectRatio === "auto") return undefined;
  return aspectRatio;
}

function normalizeKIEResolution(resolution?: string): string | undefined {
  return resolution?.trim().toLowerCase();
}

export function buildKIEVeoPayload(
  input: VideoGenerationInput,
  imageUrls?: string[],
): Record<string, unknown> {
  const refs = imageUrls?.filter(Boolean) || [];
  return {
    prompt: input.prompt,
    model: input.modelId,
    callBackUrl: input.webhookUrl,
    aspect_ratio: normalizeKIEVeoAspectRatio(input.aspectRatio),
    enableTranslation: true,
    enableFallback: false,
    generationType: refs.length ? "REFERENCE_2_VIDEO" : "TEXT_2_VIDEO",
    ...(refs.length ? { imageUrls: refs } : {}),
  };
}

export function buildKIEJobPayload(
  input: VideoGenerationInput,
  imageUrls: string[] = [],
): Record<string, unknown> {
  const inputPayload: Record<string, unknown> = {
    prompt: input.prompt,
    duration: String(input.duration ?? 5),
  };

  const aspectRatio = normalizeKIEAspectRatio(input.aspectRatio);
  if (aspectRatio) inputPayload.aspect_ratio = aspectRatio;
  if (input.negativePrompt) inputPayload.negative_prompt = input.negativePrompt;
  if (input.cfgScale !== undefined) inputPayload.cfg_scale = input.cfgScale;
  if (input.generateAudio !== undefined) {
    if (isKIESeedance2Model(input.modelId)) {
      inputPayload.generate_audio = input.generateAudio;
    } else {
      inputPayload.sound = input.generateAudio;
    }
  }
  if (input.resolution)
    inputPayload.resolution = normalizeKIEResolution(input.resolution);
  if (input.mode) inputPayload.mode = input.mode;
  if (input.seed !== undefined) inputPayload.seed = input.seed;
  if (input.cameraFixed !== undefined)
    inputPayload.camera_fixed = input.cameraFixed;

  if (imageUrls.length) {
    if (isKIESeedance2Model(input.modelId)) {
      inputPayload.reference_image_urls = imageUrls.slice(0, 9);
    } else if (isKIESoraModel(input.modelId)) {
      inputPayload.image_url = imageUrls[0];
    } else {
      inputPayload.image_urls = imageUrls;
    }
  }

  return {
    model: input.modelId,
    input: inputPayload,
    ...(input.webhookUrl ? { callBackUrl: input.webhookUrl } : {}),
  };
}

export function buildKIEWanVideoEditPayload(
  input: VideoGenerationInput,
  referenceVideoUrl?: string,
  referenceImageUrl?: string,
): Record<string, unknown> {
  if (!referenceVideoUrl) {
    throw new Error("Wan 2.7 Video Edit requires a source video URL");
  }

  const editInput: Record<string, unknown> = {
    prompt: input.prompt,
    video_url: referenceVideoUrl,
    duration: 0,
    audio_setting: "auto",
    prompt_extend: true,
    watermark: false,
  };

  if (referenceImageUrl) editInput.reference_image = referenceImageUrl;
  if (input.negativePrompt) editInput.negative_prompt = input.negativePrompt;
  if (input.resolution) editInput.resolution = input.resolution.toLowerCase();
  if (input.aspectRatio && input.aspectRatio !== "auto") {
    editInput.aspect_ratio = input.aspectRatio;
  }
  if (input.seed !== undefined) editInput.seed = input.seed;

  return {
    model: input.modelId,
    input: editInput,
    ...(input.webhookUrl ? { callBackUrl: input.webhookUrl } : {}),
  };
}

export function mapKIEVeoSuccessFlag(
  successFlag: number,
): "processing" | "succeeded" | "failed" {
  if (successFlag === 1) return "succeeded";
  if (successFlag === 2 || successFlag === 3) return "failed";
  return "processing";
}

/**
 * Upload a base64 data URI to R2 and return a public URL.
 * If the input is already a URL (http/https), return it as-is.
 */
async function ensureImageUrl(imageData: string): Promise<string> {
  if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
    return imageData;
  }

  const mimeMatch = imageData.match(/^data:(image\/\w+);base64,/);
  const contentType = mimeMatch?.[1] || "image/png";
  const ext = contentType.split("/")[1] || "png";

  const key = `kie-tmp/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const url = await uploadToR2(buffer, key, contentType);

  return url;
}

async function resolveImageUrls(
  input: VideoGenerationInput,
): Promise<string[]> {
  return input.image ? [await ensureImageUrl(input.image)] : [];
}

async function submitVeoTask(
  input: VideoGenerationInput,
  apiKey: string,
): Promise<string> {
  const url = `${KIE_BASE_URL}/api/v1/veo/generate`;
  const payload = buildKIEVeoPayload(input, await resolveImageUrls(input));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`KIE Veo API error: ${response.status} - ${error}`);
  }

  const result: KIECreateTaskResponse = await response.json();
  if (result.code !== 200) {
    throw new Error(`KIE Veo API error: ${result.msg}`);
  }

  return result.data.taskId;
}

async function submitJobTask(
  input: VideoGenerationInput,
  apiKey: string,
): Promise<string> {
  const url = `${KIE_BASE_URL}/api/v1/jobs/createTask`;
  const imageUrls = await resolveImageUrls(input);
  const payload = buildKIEJobPayload(input, imageUrls);

  if (imageUrls.length && !isKIEImageModel(input, imageUrls)) {
    throw new Error(`Model ${input.modelId} does not support image input`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`KIE API error: ${response.status} - ${error}`);
  }

  const result: KIECreateTaskResponse = await response.json();
  if (result.code !== 200) {
    throw new Error(`KIE API error: ${result.msg}`);
  }

  return result.data.taskId;
}

/**
 * Generate video with KIE.
 */
export async function generateVideoWithKIE(
  input: VideoGenerationInput,
): Promise<KIEVideoResult> {
  const apiKey = getKIEApiKey();

  const kieTaskId = isKIEVeoModel(input.modelId)
    ? await submitVeoTask(input, apiKey)
    : await submitJobTask(input, apiKey);
  console.log(`[KIE] Video task submitted: ${kieTaskId}`);

  return {
    videoUrl: "",
    externalId: kieTaskId,
  };
}

async function fetchKIEVeoTaskResult(
  kieTaskId: string,
  apiKey: string,
): Promise<{ status: string; videoUrl?: string; error?: string }> {
  const response = await fetch(
    `${KIE_BASE_URL}/api/v1/veo/record-info?taskId=${encodeURIComponent(kieTaskId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`KIE Veo status check error: ${response.status}`);
  }

  const result: KIEVeoRecordInfoResponse = await response.json();
  if (result.code !== 200) {
    throw new Error(`KIE Veo status check error: ${result.msg}`);
  }

  const { successFlag, response: veoResponse, errorMessage } = result.data;
  return {
    status: mapKIEVeoSuccessFlag(successFlag),
    videoUrl:
      veoResponse?.resultUrls?.[0] ||
      veoResponse?.fullResultUrls?.[0] ||
      veoResponse?.originUrls?.[0],
    error: errorMessage,
  };
}

function firstString(values: unknown): string | undefined {
  return Array.isArray(values) && typeof values[0] === "string"
    ? values[0]
    : undefined;
}

function parseVideoUrlFromObject(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;

  return (
    firstString(obj.resultUrls) ||
    firstString(obj.result_urls) ||
    firstString(obj.fullResultUrls) ||
    firstString(obj.originUrls) ||
    firstString(obj.videoUrls) ||
    firstString(obj.urls) ||
    (typeof obj.videoUrl === "string" ? obj.videoUrl : undefined) ||
    (typeof obj.video_url === "string" ? obj.video_url : undefined) ||
    (typeof obj.url === "string" ? obj.url : undefined) ||
    parseVideoUrlFromObject(obj.result) ||
    parseVideoUrlFromObject(obj.output) ||
    parseVideoUrlFromObject(obj.response)
  );
}

function parseVideoUrlFromResultJson(resultJson?: string): string | undefined {
  if (!resultJson) return undefined;
  try {
    return parseVideoUrlFromObject(JSON.parse(resultJson));
  } catch {
    return undefined;
  }
}

/**
 * Fetch KIE task result via recordInfo API.
 */
export async function fetchKIETaskResult(
  kieTaskId: string,
  modelId?: string,
): Promise<{ status: string; videoUrl?: string; error?: string }> {
  const apiKey = getKIEApiKey();

  if (modelId && isKIEVeoModel(modelId)) {
    return fetchKIEVeoTaskResult(kieTaskId, apiKey);
  }

  const response = await fetch(
    `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(kieTaskId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`KIE status check error: ${response.status}`);
  }

  const result: KIERecordInfoResponse = await response.json();
  if (result.code !== 200) {
    throw new Error(`KIE status check error: ${result.message}`);
  }

  const { state, resultJson, failMsg } = result.data;

  return {
    status:
      state === "success"
        ? "succeeded"
        : state === "fail"
          ? "failed"
          : "processing",
    videoUrl:
      state === "success" ? parseVideoUrlFromResultJson(resultJson) : undefined,
    error: failMsg,
  };
}

export { isKIEWanVideoEditModel };
