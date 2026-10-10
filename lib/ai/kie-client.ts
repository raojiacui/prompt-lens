import { getKieResponseText } from "./kie-response";

export const DEFAULT_KIE_CHAT_MODEL = "gemini-3-8-flash-openai";

export class KieRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "KieRequestError";
  }
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
  if (data?.error || (data?.code != null && Number(data.code) !== 200)) throw new KieRequestError(data?.error?.message || data?.msg || `KIE API error (${status})`, status);
  return getKieResponseText(payload) || "";
}

async function readChatResponse(response: Response, signal: AbortSignal) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json().catch(() => null);
    const text = readPayload(payload, response.status);
    if (!response.ok) throw new KieRequestError(payload?.error?.message || payload?.msg || `KIE API error (${response.status})`, response.status);
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
  if (!done) throw new KieRequestError("KIE streaming response was interrupted", response.status);
  if (!response.ok) throw new KieRequestError(`KIE API error (${response.status})`, response.status);
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
  const endpoint = nativeGemini ? `/gemini/v1/models/${nativeModelId}:streamGenerateContent` : `/${input.modelId}/v1/chat/completions`;
  const body = nativeGemini ? nativeGeminiBody(input.messages) : { messages: input.messages };
  // Do not retry inference automatically: a lost response may already have been billed.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new KieRequestError("KIE_ANALYSIS_TIMEOUT: model response exceeded the request deadline"));
      controller.abort();
    }, input.timeoutMs ?? 90000);
  });
  try {
    // Bound both connection and body reading even if a fetch wrapper ignores abort.
    return await Promise.race([deadline, (async () => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await readChatResponse(response, controller.signal);
      if (!text) throw new KieRequestError("KIE API returned an empty result", response.status);
      return text;
    })()]);
  } finally { clearTimeout(timer!); }
}
