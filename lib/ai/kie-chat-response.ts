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
  if (Array.isArray(data.choices) || Array.isArray(data.candidates) || Array.isArray(data.output)) return data;
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
  if (errorMessage) throw new KieApiError(
    typeof rootError?.code === "number" ? rootError.code : undefined,
    errorMessage,
  );
  if (root?.type === "error") {
    throw new KieApiError(undefined, compactMessage(root.message) || "response stream failed");
  }
}

function readResponsesText(body: JsonRecord): string | null {
  throwForKieError(body);
  if (["failed", "incomplete", "cancelled", "in_progress", "queued"].includes(String(body.status))) {
    throw new KieApiError(undefined, `response ${String(body.status)}`);
  }
  if (!Array.isArray(body.output)) return null;
  const text = body.output.flatMap((item) => {
    if (!isRecord(item) || item.type !== "message" || item.role !== "assistant") return [];
    if (item.status && item.status !== "completed") {
      throw new KieApiError(undefined, `message ${String(item.status)}`);
    }
    if (!Array.isArray(item.content)) return [];
    return item.content.flatMap((part) => isRecord(part) && part.type === "output_text" && typeof part.text === "string"
      ? [part.text] : []);
  }).join("");
  return text.trim() || null;
}

export function parseKieChatResponse(data: unknown): string {
  throwForKieError(data);

  const body = responseBody(data);
  const responsesText = body && readResponsesText(body);
  if (responsesText) return responsesText;
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
  throw new Error(`KIE returned no text${reason}`);
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
  let responsesStream = false;
  let responsesCompleted = false;
  let completedText: string | null = null;

  const flushEvent = () => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join("\n");
    dataLines = [];
    if (payload === "[DONE]") return;

    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error("KIE stream returned invalid JSON");
    }

    throwForKieError(data);
    if (isRecord(data) && typeof data.type === "string" && data.type.startsWith("response.")) {
      responsesStream = true;
      if (data.type === "response.failed" || data.type === "response.incomplete") {
        if (isRecord(data.response)) readResponsesText(data.response);
        throw new KieApiError(undefined, data.type);
      }
      if (data.type === "response.output_text.delta" && typeof data.delta === "string") output += data.delta;
      if (data.type === "response.completed") {
        if (!isRecord(data.response) || data.response.status !== "completed") {
          throw new KieApiError(undefined, "response completed without a completed result");
        }
        completedText = readResponsesText(data.response);
        responsesCompleted = true;
      }
      return;
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

  if (responsesStream && !responsesCompleted) throw new Error("KIE response stream ended before completion");
  if (completedText) return completedText;
  if (!output.trim()) throw new Error("KIE stream returned no text");
  return output.trim();
}
