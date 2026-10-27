type Message = { role: string; content: unknown };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));

export class KieResponsesError extends Error {
  constructor(message: string, readonly outcome: "unknown" | "confirmed_failure" | "not_sent" = "unknown", readonly providerCode?: number | string) { super(message); }
}

export function kieResponsesBody(model: string, messages: Message[]) {
  return { model, stream: true, reasoning: { effort: "none" }, input: messages.map(message => {
    if (!["system", "user", "assistant"].includes(message.role)) throw new KieResponsesError("Unsupported Responses message role", "not_sent");
    const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (!Array.isArray(parts)) throw new KieResponsesError("Invalid Responses message content", "not_sent");
    return { role: message.role, content: parts.map(part => {
      if (record(part) && part.type === "text" && typeof part.text === "string") return { type: message.role === "assistant" ? "output_text" : "input_text", text: part.text };
      if (record(part) && part.type === "image_url" && record(part.image_url) && typeof part.image_url.url === "string" && message.role === "user") {
        const url = part.image_url.url;
        if (!url.startsWith("data:image/")) {
          let parsed: URL;
          try { parsed = new URL(url); } catch { throw new KieResponsesError("Invalid analysis image URL", "not_sent"); }
          if (parsed.protocol !== "https:" || /\.(?:mp4|mov|webm|m4a|mp3)$/i.test(parsed.pathname)) throw new KieResponsesError("DeepSeek analysis requires image frames", "not_sent");
        }
        return { type: "input_image", image_url: url };
      }
      throw new KieResponsesError("Unsupported Responses content", "not_sent");
    }) };
  }) };
}

function checkError(payload: unknown, status: number) {
  if (!record(payload)) return;
  const error = record(payload.error) ? payload.error : null;
  const code = payload.code ?? error?.code;
  const failedCode = code !== undefined && code !== null && code !== 200 && code !== "200";
  if (error || failedCode || payload.type === "error" || status >= 400) {
    const detail = error?.message ?? payload.msg ?? payload.message;
    const numericCode = Number(code ?? status);
    throw new KieResponsesError(typeof detail === "string" ? detail : `KIE API error (${status})`, numericCode >= 400 && numericCode < 500 ? "confirmed_failure" : "unknown", typeof code === "number" || typeof code === "string" ? code : undefined);
  }
}

function responseText(payload: unknown, status: number): string {
  checkError(payload, status);
  if (!record(payload) || payload.status !== "completed") throw new KieResponsesError("KIE response did not complete");
  if (!Array.isArray(payload.output)) return "";
  return payload.output.flatMap(item => {
    if (!record(item) || item.type !== "message" || item.role !== "assistant") return [];
    if (item.status && item.status !== "completed") throw new KieResponsesError("KIE assistant output did not complete");
    return Array.isArray(item.content) ? item.content.flatMap(part => record(part) && part.type === "output_text" && typeof part.text === "string" ? [part.text] : []) : [];
  }).join("");
}

export async function readKieResponses(response: Response, signal: AbortSignal) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    let payload: unknown;
    try { payload = JSON.parse(await response.text()); }
    catch { throw new KieResponsesError("KIE Responses body was interrupted or invalid"); }
    return responseText(payload, response.status).trim();
  }
  if (!response.body) throw new KieResponsesError("KIE Responses stream was empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", completed = false, closed = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const consume = (event: string) => {
    const lines = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart());
    if (!lines.length || lines.join("\n").trim() === "[DONE]") return;
    let payload: unknown;
    try { payload = JSON.parse(lines.join("\n")); } catch { throw new KieResponsesError("KIE Responses stream contained invalid JSON"); }
    checkError(payload, response.status);
    if (!record(payload)) return;
    if (payload.type === "response.failed" || payload.type === "response.incomplete") {
      checkError(payload.response, response.status);
      throw new KieResponsesError("KIE response did not complete");
    }
    if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") text += payload.delta;
    if (payload.type === "response.completed") { text = responseText(payload.response, response.status) || text; completed = true; }
  };
  try {
    while (!completed && !closed) {
      const chunk = await reader.read(); closed = chunk.done;
      buffer += closed ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while (!completed && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (closed && !completed && buffer) consume(buffer);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!closed) cancel();
    reader.releaseLock();
  }
  if (!completed) throw new KieResponsesError("KIE Responses stream ended before completion");
  return text.trim();
}
