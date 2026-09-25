import { getKieResponseText } from "./kie-response";

export const DEFAULT_KIE_CHAT_MODEL = "gemini-3-8-flash-openai";

export class KieRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "KieRequestError";
  }
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
  // Do not retry inference automatically: a lost response may already have been billed.
  const response = await fetch(`${baseUrl}/${input.modelId}/v1/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(input.timeoutMs ?? 90000),
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: input.messages }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new KieRequestError(payload?.error?.message || payload?.msg || `KIE API error (${response.status})`, response.status);
  const text = getKieResponseText(payload);
  if (!text) throw new KieRequestError("KIE API returned an empty result", response.status);
  return text;
}
