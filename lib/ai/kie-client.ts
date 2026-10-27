import { getKieResponseText } from "./kie-response";
import { kieResponsesBody, KieResponsesError, readKieResponses } from "./kie-responses";

export const DEFAULT_KIE_CHAT_MODEL = "gemini-3-8-flash-openai";
export const DEFAULT_KIE_ANALYSIS_TIMEOUT_MS = 180_000;

export class KieRequestError extends Error {
  providerCode?: number | string;
  modelId?: string;
  endpoint?: string;
  constructor(message: string, readonly status?: number, readonly outcome?: "unknown" | "confirmed_failure" | "not_sent", cause?: unknown) {
    super(message);
    this.name = "KieRequestError";
    if (cause !== undefined) this.cause = cause;
  }
}

function connectionNotEstablished(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const value = error as { code?: string; cause?: unknown; errors?: unknown[] };
  if (value.code) return ["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(value.code);
  if (value.errors?.length) return value.errors.every(item => connectionNotEstablished(item, depth + 1));
  return connectionNotEstablished(value.cause, depth + 1);
}

function nativeGeminiBody(messages: Array<{ role: string; content: unknown }>) {
  const parts = (content: unknown) => {
    if (typeof content === "string") return [{ text: content }];
    if (!Array.isArray(content)) throw new KieRequestError("Invalid Gemini message content");
    return content.map(part => {
      if (part.type === "text" && typeof part.text === "string") return { text: part.text };
      if (part.type === "image_url" && typeof part.image_url?.url === "string") {
        const url = part.image_url.url;
        const path = new URL(url).pathname.toLowerCase();
        const mimeType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".m4a") ? "audio/mp4" : "image/jpeg";
        return { fileData: { mimeType, fileUri: url } };
      }
      throw new KieRequestError("Unsupported Gemini message content");
    });
  };
  const systemParts = messages.filter(message => message.role === "system").flatMap(message => parts(message.content));
  return {
    stream: true,
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    contents: messages.filter(message => message.role !== "system").map(message => ({ role: message.role === "assistant" ? "model" : "user", parts: parts(message.content) })),
  };
}

function readPayload(payload: unknown, status: number) {
  const data = payload as { code?: unknown; error?: { message?: string }; msg?: string } | null;
  if (data?.error || (data?.code != null && Number(data.code) !== 200)) {
    const error = new KieRequestError(data?.error?.message || data?.msg || `KIE API error (${status})`, status, status >= 500 ? "unknown" : "confirmed_failure");
    if (typeof data?.code === "number" || typeof data?.code === "string") error.providerCode = data.code;
    throw error;
  }
  return getKieResponseText(payload) || "";
}

async function readChatResponse(response: Response, signal: AbortSignal) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    let raw: string;
    try { raw = await response.text(); }
    catch (error) { throw new KieRequestError("KIE response body was interrupted", response.status, "unknown", error); }
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { throw new KieRequestError(response.ok ? "KIE returned invalid JSON" : `KIE API error (${response.status})`, response.status, response.status >= 500 ? "unknown" : "confirmed_failure"); }
    const text = readPayload(payload, response.status);
    if (!response.ok) {
      const data = payload as { error?: { message?: string }; msg?: string } | null;
      throw new KieRequestError(data?.error?.message || data?.msg || `KIE API error (${response.status})`, response.status, response.status >= 500 ? "unknown" : "confirmed_failure");
    }
    return text;
  }
  if (!response.body) throw new KieRequestError("KIE returned an empty streaming response", response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let done = false;
  let closed = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const consume = (event: string) => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") { done = true; return; }
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { throw new KieRequestError("KIE returned an invalid streaming response", response.status); }
    text += readPayload(payload, response.status);
  };
  try {
    // Completion belongs to the SSE protocol, not the lifetime of the HTTP connection.
    while (!done && !closed) {
      const chunk = await reader.read();
      closed = chunk.done;
      buffer += closed ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while (!done && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (closed && !done && buffer) consume(buffer);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!closed) cancel();
    reader.releaseLock();
  }
  if (!done) throw new KieRequestError("KIE streaming response was interrupted", response.status, "unknown");
  if (!response.ok) throw new KieRequestError(`KIE API error (${response.status})`, response.status, response.status >= 500 ? "unknown" : "confirmed_failure");
  return text;
}

export async function requestKieChat(input: {
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: unknown }>;
  timeoutMs?: number;
}) {
  if (!input.apiKey) throw new KieRequestError("KIE API Key is not configured");
  if (!/^[a-zA-Z0-9._-]+$/.test(input.modelId)) throw new KieRequestError("Invalid KIE chat model");
  const baseUrl = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
  // Preserve stored model IDs while using the documented native Gemini protocol.
  const nativeGemini = /^gemini-3-[5678]-flash(?:-openai)?$/.test(input.modelId);
  const nativeModelId = input.modelId.replace(/-openai$/, "");
  const responses = input.modelId === "deepseek-v4-1-flash";
  const endpoint = responses ? "/openai/v1/responses" : nativeGemini ? `/gemini/v1/models/${nativeModelId}:streamGenerateContent` : `/${input.modelId}/v1/chat/completions`;
  let body: unknown;
  try { body = responses ? kieResponsesBody(input.modelId, input.messages) : nativeGemini ? nativeGeminiBody(input.messages) : { messages: input.messages }; }
  catch (error) { throw new KieRequestError(error instanceof Error ? error.message : "Invalid analysis input", undefined, "not_sent"); }
  // Only retry proof of an unopened connection; response loss may already have been billed.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let stage: "connecting" | "reading_response" = "connecting";
  const startedAt = Date.now();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.warn("kie.analysis.timeout", { modelId: input.modelId, stage, elapsedMs: Date.now() - startedAt });
      reject(new KieRequestError(`KIE_ANALYSIS_TIMEOUT: ${stage} exceeded the request deadline`, undefined, "unknown"));
      controller.abort();
    }, input.timeoutMs ?? 90_000);
  });
  try {
    // Bound both connection and body reading even if a fetch wrapper ignores abort.
    return await Promise.race([deadline, (async () => {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (controller.signal.aborted) throw new KieRequestError("KIE_ANALYSIS_TIMEOUT", undefined, "unknown");
        try {
          response = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
            headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          break;
        } catch (error) {
          const notSent = connectionNotEstablished(error);
          if (!notSent || attempt === 1 || controller.signal.aborted) {
            throw new KieRequestError("KIE transport failed during connecting", undefined, notSent ? "not_sent" : "unknown", error);
          }
          console.warn("kie.analysis.connection_retry", { modelId: input.modelId, attempt: 2, elapsedMs: Date.now() - startedAt });
        }
      }
      if (!response) throw new KieRequestError("KIE connection unavailable", undefined, "not_sent");
      stage = "reading_response";
      let text: string;
      try { text = responses ? await readKieResponses(response, controller.signal) : await readChatResponse(response, controller.signal); }
      catch (error) {
        if (!(error instanceof KieResponsesError)) throw error;
        const failure = new KieRequestError(error.message, response.status, error.outcome);
        failure.providerCode = error.providerCode;
        throw failure;
      }
      if (!text) throw new KieRequestError("KIE API returned an empty result", response.status);
      return text;
    })()]);
  } catch (error) {
    if (error instanceof KieRequestError) {
      error.modelId = input.modelId;
      error.endpoint = endpoint;
      throw error;
    }
    throw new KieRequestError(`KIE transport failed during ${stage}`, undefined, "unknown", error);
  } finally { clearTimeout(timer!); }
}
