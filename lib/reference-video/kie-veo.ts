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

export type KieErrorKind =
  | "quota_exceeded"
  | "auth"
  | "rate_limited"
  | "provider_error";

export class KieProviderError extends Error {
  readonly code?: number;
  readonly kind: KieErrorKind;
  readonly status: number;
  readonly providerMessage?: string;

  constructor(input: {
    code?: number;
    kind?: KieErrorKind;
    message: string;
    providerMessage?: string;
    status?: number;
  }) {
    super(input.message);
    this.name = "KieProviderError";
    this.code = input.code;
    this.kind = input.kind || classifyKieError(input.providerMessage || input.message, input.code);
    this.status = input.status || kieHttpStatusForKind(this.kind);
    this.providerMessage = input.providerMessage;
  }
}

function getApiKey() {
  const apiKey = process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY;
  if (!apiKey)
    throw new Error("KIE_AI_API_KEY or KIE_API_KEY is not configured");
  return apiKey;
}

function classifyKieError(message: string, code?: number): KieErrorKind {
  const normalized = message.toLowerCase();
  if (
    code === 433 ||
    /points?.*(exceeded|exceed|limit|insufficient|not enough|used)/i.test(message) ||
    /(quota|balance|credit).*(exceeded|exceed|insufficient|not enough|limit)/i.test(message)
  ) {
    return "quota_exceeded";
  }
  if (code === 401 || code === 403 || /api.?key|unauthori[sz]ed|forbidden|invalid key/i.test(message)) {
    return "auth";
  }
  if (code === 429 || /rate limit|too many requests/i.test(normalized)) {
    return "rate_limited";
  }
  return "provider_error";
}

function kieHttpStatusForKind(kind: KieErrorKind) {
  switch (kind) {
    case "quota_exceeded":
      return 402;
    case "auth":
      return 401;
    case "rate_limited":
      return 429;
    default:
      return 502;
  }
}

export function friendlyKieErrorMessage(kind: KieErrorKind) {
  switch (kind) {
    case "quota_exceeded":
      return "当前 KIE API Key 的点数/额度已经用完，视频生成暂时无法继续。请到 Kie.ai 充值或在设置里更换一个有余额的 KIE API Key 后再试。";
    case "auth":
      return "KIE API Key 校验失败。请到设置里检查或重新配置你的 KIE API Key。";
    case "rate_limited":
      return "KIE 请求过于频繁，请稍后再试。";
    default:
      return "KIE 视频生成服务返回异常，请稍后再试或检查 KIE 控制台。";
  }
}

export function kieErrorResponse(error: unknown) {
  if (!(error instanceof KieProviderError)) return null;
  return {
    status: error.status,
    body: {
      error: error.message,
      code: `KIE_${error.kind.toUpperCase()}`,
      providerCode: error.code,
      providerMessage: error.providerMessage,
    },
  };
}

function createKieProviderError(input: {
  code?: number;
  message?: string;
  fallbackMessage: string;
  status?: number;
}) {
  const providerMessage = input.message || input.fallbackMessage;
  const kind = classifyKieError(providerMessage, input.code);
  return new KieProviderError({
    code: input.code,
    kind,
    providerMessage,
    message: friendlyKieErrorMessage(kind),
    status: kind === "provider_error" ? input.status : undefined,
  });
}

function assertKieSuccess(payload: unknown, fallbackMessage: string) {
  if (typeof payload === "object" && payload !== null && "code" in payload) {
    const code = (payload as { code?: number }).code;
    if (code !== 200) {
      throw createKieProviderError({
        code,
        message:
          (payload as { msg?: string; message?: string }).msg ||
          (payload as { message?: string }).message,
        fallbackMessage,
      });
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

export async function createKieVeoGeneration(input: KieVideoGenerationRequest, apiKey?: string) {
  const generationInput = buildGenerationInput(input);
  const imageUrls = input.imageUrls?.filter(Boolean) || [];
  const usesVeo = isKIEVeoModel(generationInput.modelId);
  const usesWanVideoEdit = isKIEWanVideoEditModel(generationInput.modelId);
  const response = await fetch(
    `${baseUrl}${usesVeo ? veoGenerateEndpoint : jobsGenerateEndpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey || getApiKey()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20000),
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

  const responseText = await response.text();
  let payload: {
    code?: number;
    msg?: string;
    message?: string;
    data?: { taskId?: string };
    taskId?: string;
  } | null = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw createKieProviderError({
      code: payload?.code || response.status,
      message:
        payload?.msg ||
        payload?.message ||
        (responseText ? responseText.slice(0, 500) : undefined),
      fallbackMessage: "Video generation request failed",
      status: response.status,
    });
  }
  assertKieSuccess(payload, "Video generation request failed");
  const taskId = payload?.data?.taskId || payload?.taskId;
  if (!taskId) throw new Error("KIE response did not include taskId");
  return { taskId, raw: payload };
}

export async function getKieVeoGenerationStatus(
  taskId: string,
  model?: string | null,
  apiKey?: string,
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
    Authorization: `Bearer ${apiKey || getApiKey()}`,
    Accept: "application/json",
  };
  let response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20000),
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
  if (!response.ok) {
    const providerMessage = parseStatusError(payload);
    const payloadCode =
      typeof payload === "object" && payload !== null && "code" in payload
        ? (payload as { code?: number }).code
        : undefined;
    throw createKieProviderError({
      code: payloadCode || response.status,
      message: providerMessage,
      fallbackMessage: "Video status request failed",
      status: response.status,
    });
  }
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
