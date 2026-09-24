type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.replace(/\s+/g, " ").trim();
  return message ? message.slice(0, 240) : null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!Array.isArray(value)) return null;

  const text = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("")
    .trim();

  return text || null;
}

function responseBody(data: unknown): JsonRecord | null {
  if (!isRecord(data)) return null;
  if (Array.isArray(data.choices) || Array.isArray(data.candidates)) return data;
  return isRecord(data.data) ? data.data : data;
}

export function summarizeKieChatResponse(data: unknown) {
  const root = isRecord(data) ? data : null;
  const body = responseBody(data);
  const choices = body && Array.isArray(body.choices) ? body.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const candidates = body && Array.isArray(body.candidates) ? body.candidates : [];
  const candidate = isRecord(candidates[0]) ? candidates[0] : null;

  return {
    responseType: Array.isArray(data) ? "array" : typeof data,
    code: root?.code ?? null,
    message: compactMessage(root?.msg) || compactMessage(root?.message),
    choiceCount: choices.length,
    candidateCount: candidates.length,
    finishReason: choice?.finish_reason ?? candidate?.finishReason ?? null,
    contentType: message ? (Array.isArray(message.content) ? "array" : typeof message.content) : null,
  };
}

export function parseKieChatResponse(data: unknown): string {
  const root = isRecord(data) ? data : null;
  const code = root?.code;
  const upstreamMessage = compactMessage(root?.msg) || compactMessage(root?.message);

  if (code !== undefined && code !== 200 && code !== "200") {
    throw new Error(`KIE API error (${String(code)}): ${upstreamMessage || "request failed"}`);
  }

  const rootError = root && isRecord(root.error) ? root.error : null;
  const errorMessage = compactMessage(rootError?.message) || compactMessage(root?.error);
  if (errorMessage) throw new Error(`KIE API error: ${errorMessage}`);

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
