import { createHash } from "node:crypto";
import { KieEmptyResultError, KieRequestError } from "./kie-client";
import { infistarModels } from "./infistar-models";

export function infistarBaseUrl() {
  return (process.env.INFISTAR_API_BASE_URL || "https://infistar.cc/v1").replace(/\/$/, "");
}

export function infistarChatModel(modelId: string) {
  return modelId.replace(/^analysis-/, "").replace(/-openai$/, "").replace(/^gemini-(\d)-(\d)-/, "gemini-$1.$2-").replace(/^deepseek-v4-1-flash$/, "deepseek-v4.1-flash");
}

export class InfistarRequestError extends KieRequestError {
  constructor(message: string, status?: number, outcome?: "unknown" | "confirmed_failure" | "not_sent", cause?: unknown) {
    super(message, status, outcome, cause);
    this.name = "InfistarRequestError";
  }
}

type InfistarModel = { id: string; supported_endpoint_types?: string[] };
const catalogCache = new Map<string, { expiresAt: number; models: InfistarModel[] }>();
export async function listInfistarModels(apiKey: string, options: { refresh?: boolean } = {}): Promise<InfistarModel[]> {
  const cacheKey = createHash("sha256").update(infistarBaseUrl() + apiKey).digest("hex");
  const cached = catalogCache.get(cacheKey);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.models;
  const response = await fetch(`${infistarBaseUrl()}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new InfistarRequestError(`Infistar 模型查询失败 (${response.status})，请检查 Key 权限及余额。`, response.status, "not_sent");
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new InfistarRequestError("Infistar 返回了无效的模型列表", response.status, "not_sent");
  const models = body.data.filter((model: InfistarModel) => typeof model?.id === "string");
  if (catalogCache.size >= 100) catalogCache.clear();
  catalogCache.set(cacheKey, { models, expiresAt: Date.now() + 60_000 });
  return models;
}

export async function assertInfistarModel(apiKey: string, modelId: string) {
  const listed = (await listInfistarModels(apiKey)).some(model => model.id === modelId);
  // Auto-group routing can accept verified video IDs omitted from /models.
  const configuredVideo = infistarModels.some(model => model.enabled && model.providerModelId === modelId);
  if (!listed && !configuredVideo) {
    throw new InfistarRequestError(`Infistar 当前 Key 无法调用 ${modelId}，请检查令牌分组或选择可用模型。`, undefined, "not_sent");
  }
}

export async function infistarJson(path: string, apiKey: string, body?: unknown, timeoutMs = 20_000) {
  let response: Response;
  try {
    response = await fetch(`${infistarBaseUrl()}${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  } catch (error) { throw new InfistarRequestError("Infistar 请求中断，请先核对任务状态再重试。", undefined, body === undefined ? "not_sent" : "unknown", error); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    // Do not echo upstream response bodies: they can contain request details and credentials.
    throw new InfistarRequestError(`Infistar 请求失败 (${response.status})，请检查模型、参数、Key 权限及余额。`, response.status, response.status >= 500 ? "unknown" : "confirmed_failure");
  }
  if (!payload) throw new InfistarRequestError("Infistar 返回了无效响应，请先核对任务状态。", response.status, "unknown");
  return payload;
}

export async function requestInfistarChat(input: {
  apiKey: string; modelId: string; messages: Array<{ role: string; content: unknown }>; timeoutMs?: number;
}) {
  const modelId = infistarChatModel(input.modelId);
  await assertInfistarModel(input.apiKey, modelId);
  const payload = await infistarJson("/chat/completions", input.apiKey, { model: modelId, messages: input.messages, stream: false }, input.timeoutMs ?? 180_000);
  const content = payload.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(part => typeof part?.text === "string" ? part.text : "").join("") : "";
  if (!text.trim()) throw new KieEmptyResultError(200);
  return text;
}
