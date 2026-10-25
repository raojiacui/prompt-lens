type JsonRecord = Record<string, unknown>;

export class KieApiError extends Error {
  constructor(
    public readonly code: string | number | undefined,
    detail: string,
  ) {
    // Provider errors can echo presigned media URLs; never log their credentials.
    const safeDetail = detail
      .replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, "[inline image]")
      .replace(/https?:\/\/[^\s<>"']+/gi, "[media URL]")
      .slice(0, 500);
    super(code === undefined ? `KIE API error: ${safeDetail}` : `KIE API error (${String(code)}): ${safeDetail}`);
    this.name = "KieApiError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.replace(/\s+/g, " ").trim();
  return message || null;
}

function readText(value: unknown, preserveWhitespace = false): string | null {
  if (typeof value === "string") {
    if (!value.trim()) return null;
    return preserveWhitespace ? value : value.trim();
  }
  if (!Array.isArray(value)) return null;

  const text = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("");

  if (!text.trim()) return null;
  return preserveWhitespace ? text : text.trim();
}

function responseBody(data: unknown): JsonRecord | null {
  if (!isRecord(data)) return null;
  if (Array.isArray(data.choices) || Array.isArray(data.candidates)) return data;
  return isRecord(data.data) ? data.data : data;
}

function throwForKieError(data: unknown) {
  const root = isRecord(data) ? data : null;
  const code = root?.code;
  const upstreamMessage = compactMessage(root?.msg) || compactMessage(root?.message);

  if (code !== undefined && code !== 200 && code !== "200") {
    throw new KieApiError(code as string | number, upstreamMessage || "request failed");
  }

  const rootError = root && isRecord(root.error) ? root.error : null;
  const errorMessage = compactMessage(rootError?.message) || compactMessage(root?.error);
  if (errorMessage) throw new KieApiError(undefined, errorMessage);
}

export function parseKieChatResponse(data: unknown): string {
  throwForKieError(data);

  const body = responseBody(data);
  const choices = body && Array.isArray(body.choices) ? body.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const openAiContent = readText(message?.content);
  if (openAiContent) return openAiContent;

  const candidates = body && Array.isArray(body.candidates) ? body.candidates : [];
  const candidate = isRecord(candidates[0]) ? candidates[0] : null;
  const candidateContent = candidate && isRecord(candidate.content) ? candidate.content : null;
  const nativeContent = readText(candidateContent?.parts);
  if (nativeContent) return nativeContent;

  const finishReason = choice?.finish_reason ?? candidate?.finishReason;
  const reason = finishReason ? ` (finish_reason: ${String(finishReason)})` : "";
  throw new Error(`KIE Gemini returned no text${reason}`);
}

function readStreamChunk(data: unknown): string | null {
  throwForKieError(data);

  const body = responseBody(data);
  const choices = body && Array.isArray(body.choices) ? body.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const delta = choice && isRecord(choice.delta) ? choice.delta : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const openAiContent = readText(delta?.content ?? message?.content, true);
  if (openAiContent) return openAiContent;

  const candidates = body && Array.isArray(body.candidates) ? body.candidates : [];
  const candidate = isRecord(candidates[0]) ? candidates[0] : null;
  const candidateContent = candidate && isRecord(candidate.content) ? candidate.content : null;
  return readText(candidateContent?.parts, true);
}

export function parseKieChatEventStream(stream: string): string {
  let output = "";
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join("\n");
    dataLines = [];
    if (payload === "[DONE]") return;

    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error("KIE Gemini stream returned invalid JSON");
    }

    output += readStreamChunk(data) || "";
  };

  for (const line of stream.split(/\r?\n/)) {
    if (line === "") {
      flushEvent();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  flushEvent();

  if (!output.trim()) throw new Error("KIE Gemini stream returned no text");
  return output.trim();
}
