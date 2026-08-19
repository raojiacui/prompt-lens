import {
  buildKIEJobPayload,
  buildKIEWanVideoEditPayload,
  buildKIEVeoPayload,
  isKIEVeoModel,
} from "@/lib/ai/adapters/kie-video";

export type KieVideoGenerationRequest = {
  prompt: string;
  imageUrls?: string[];
  referenceVideoUrl?: string;
  referenceImageUrl?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  model?: string;
  generationType?:
    | "TEXT_2_VIDEO"
    | "FIRST_AND_LAST_FRAMES_2_VIDEO"
    | "REFERENCE_2_VIDEO";
  callBackUrl?: string;
  duration?: number;
  resolution?: string;
  generateAudio?: boolean;
  cameraFixed?: boolean;
  seed?: number;
};

export type KieVeoGenerationRequest = KieVideoGenerationRequest;

export type KieVeoStatus = {
  taskId: string;
  state: "generating" | "success" | "fail" | string;
  videoUrl?: string;
  error?: string;
  raw: unknown;
};

const baseUrl = process.env.KIE_AI_BASE_URL || "https://api.kie.ai";
const veoGenerateEndpoint =
  process.env.KIE_VEO_GENERATE_ENDPOINT || "/api/v1/veo/generate";
const veoStatusEndpoint =
  process.env.KIE_VEO_STATUS_ENDPOINT || "/api/v1/veo/record-info";
const jobsGenerateEndpoint =
  process.env.KIE_JOBS_GENERATE_ENDPOINT || "/api/v1/jobs/createTask";
const jobsStatusEndpoint =
  process.env.KIE_JOBS_STATUS_ENDPOINT || "/api/v1/jobs/recordInfo";
const alephStatusEndpoint =
  process.env.KIE_ALEPH_STATUS_ENDPOINT || "/api/v1/aleph/record-detail";
const runwayStatusEndpoint =
  process.env.KIE_RUNWAY_STATUS_ENDPOINT || "/api/v1/runway/record-detail";

function getApiKey() {
  const apiKey = process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY;
  if (!apiKey)
    throw new Error("KIE_AI_API_KEY or KIE_API_KEY is not configured");
  return apiKey;
}

function assertKieSuccess(payload: unknown, fallbackMessage: string) {
  if (typeof payload === "object" && payload !== null && "code" in payload) {
    const code = (payload as { code?: number }).code;
    if (code !== 200) {
      throw new Error(
        `kie.ai error ${code}: ${(payload as { msg?: string; message?: string }).msg || (payload as { message?: string }).message || fallbackMessage}`,
      );
    }
  }
}

function firstString(values: unknown) {
  return Array.isArray(values) && typeof values[0] === "string"
    ? values[0]
    : undefined;
}

function parseResultJson(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    return parseResultUrls(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function firstText(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseStatusError(data: unknown): string | undefined {
  if (typeof data === "string") return data.trim() || undefined;
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;

  const direct = firstText([
    obj.failMsg,
    obj.failReason,
    obj.errorMessage,
    obj.error_message,
    obj.error,
    obj.message,
    obj.msg,
  ]);
  if (direct) return direct;

  const nested =
    parseStatusError(obj.response) ||
    parseStatusError(obj.result) ||
    parseStatusError(obj.output) ||
    parseStatusError(obj.info) ||
    parseStatusError(obj.data);
  if (nested) return nested;

  if (typeof obj.resultJson === "string") {
    try {
      return parseStatusError(JSON.parse(obj.resultJson));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function parseResultUrls(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  const response =
    typeof obj.response === "object" && obj.response !== null
      ? obj.response
      : undefined;
  const info =
    typeof obj.info === "object" && obj.info !== null ? obj.info : undefined;

  return (
    firstString(obj.resultUrls) ||
    firstString(obj.result_urls) ||
    firstString(obj.fullResultUrls) ||
    firstString(obj.originUrls) ||
    firstString(obj.videoUrls) ||
    (typeof obj.videoUrl === "string" ? obj.videoUrl : undefined) ||
    (typeof obj.video_url === "string" ? obj.video_url : undefined) ||
    (typeof obj.url === "string" ? obj.url : undefined) ||
    parseResultUrls(response) ||
    parseResultUrls(info) ||
    parseResultUrls(obj.result) ||
    parseResultUrls(obj.output) ||
    parseResultUrls(obj.videoInfo) ||
    parseResultJson(obj.resultJson)
  );
}

function isKIEAlephModel(modelId?: string | null) {
  return modelId === "runway/aleph" || modelId === "aleph";
}

function isKIEWanVideoEditModel(modelId?: string | null) {
  return modelId === "wan/2-7-videoedit";
}

function buildGenerationInput(input: KieVideoGenerationRequest) {
  const modelId = input.model || process.env.KIE_VEO_MODEL || "veo3_fast";
  return {
    prompt: input.prompt,
    provider: "kie" as const,
    modelId,
    duration: input.duration ?? 8,
    webhookUrl: input.callBackUrl,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    generateAudio: input.generateAudio,
    cameraFixed: input.cameraFixed,
    seed: input.seed,
    referenceVideoUrl: input.referenceVideoUrl,
    referenceImageUrl: input.referenceImageUrl,
    negativePrompt: input.negativePrompt,
  };
}

export async function createKieVeoGeneration(input: KieVideoGenerationRequest) {
  const generationInput = buildGenerationInput(input);
  const imageUrls = input.imageUrls?.filter(Boolean) || [];
  const usesVeo = isKIEVeoModel(generationInput.modelId);
  const usesWanVideoEdit = isKIEWanVideoEditModel(generationInput.modelId);
  const response = await fetch(
    `${baseUrl}${usesVeo ? veoGenerateEndpoint : jobsGenerateEndpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        usesWanVideoEdit
          ? buildKIEWanVideoEditPayload(
              generationInput,
              input.referenceVideoUrl,
              input.referenceImageUrl,
            )
          : usesVeo
            ? buildKIEVeoPayload(generationInput, imageUrls)
            : buildKIEJobPayload(generationInput, imageUrls),
      ),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`kie.ai request failed: ${response.status}`);
  assertKieSuccess(payload, "Video generation request failed");
  const taskId = payload?.data?.taskId || payload?.taskId;
  if (!taskId) throw new Error("KIE response did not include taskId");
  return { taskId, raw: payload };
}

export async function getKieVeoGenerationStatus(
  taskId: string,
  model?: string | null,
): Promise<KieVeoStatus> {
  const usesAleph = isKIEAlephModel(model);
  const usesVeo = !usesAleph && (!model || isKIEVeoModel(model));
  const statusEndpoint = usesAleph
    ? alephStatusEndpoint
    : usesVeo
      ? veoStatusEndpoint
      : jobsStatusEndpoint;
  const url = new URL(`${baseUrl}${statusEndpoint}`);
  url.searchParams.set("taskId", taskId);
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    Accept: "application/json",
  };
  let response = await fetch(url, {
    method: "GET",
    headers,
  });
  if (
    usesAleph &&
    response.status === 404 &&
    statusEndpoint !== runwayStatusEndpoint
  ) {
    const fallbackUrl = new URL(`${baseUrl}${runwayStatusEndpoint}`);
    fallbackUrl.searchParams.set("taskId", taskId);
    response = await fetch(fallbackUrl, {
      method: "GET",
      headers,
    });
  }
  let payload = await response.json().catch(() => null);
  if (
    usesAleph &&
    response.ok &&
    (!payload || payload.data === null || payload.data === undefined)
  ) {
    const jobsUrl = new URL(`${baseUrl}${jobsStatusEndpoint}`);
    jobsUrl.searchParams.set("taskId", taskId);
    response = await fetch(jobsUrl, {
      method: "GET",
      headers,
    });
    payload = await response.json().catch(() => null);
  }
  if (!response.ok) throw new Error(`kie.ai status failed: ${response.status}`);
  assertKieSuccess(payload, "Video status request failed");

  const data =
    typeof payload?.data === "object" && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : {};
  if (usesAleph) {
    const successFlag = data.successFlag;
    const providerState =
      typeof data.state === "string" ? data.state : undefined;
    const videoUrl = parseResultUrls(data);
    return {
      taskId: typeof data.taskId === "string" ? data.taskId : taskId,
      state:
        providerState === "success" || successFlag === 1
          ? "success"
          : providerState === "fail" ||
              providerState === "failed" ||
              successFlag === 2 ||
              successFlag === 3 ||
              data.errorCode
            ? "fail"
            : "generating",
      videoUrl,
      error: parseStatusError(data) || parseStatusError(payload),
      raw: payload,
    };
  }
  if (!usesVeo) {
    const providerState =
      typeof data.state === "string" ? data.state : "generating";
    return {
      taskId: typeof data.taskId === "string" ? data.taskId : taskId,
      state:
        providerState === "success"
          ? "success"
          : providerState === "fail"
            ? "fail"
            : "generating",
      videoUrl: parseResultUrls(data),
      error: parseStatusError(data) || parseStatusError(payload),
      raw: payload,
    };
  }

  const successFlag = data.successFlag;
  const state =
    successFlag === 1
      ? "success"
      : successFlag === 2 || successFlag === 3
        ? "fail"
        : "generating";
  return {
    taskId: typeof data.taskId === "string" ? data.taskId : taskId,
    state,
    videoUrl: parseResultUrls(data),
    error: parseStatusError(data) || parseStatusError(payload),
    raw: payload,
  };
}
