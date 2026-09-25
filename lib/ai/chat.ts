import { getKieResponseText } from "@/lib/ai/kie-response";
import { resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";

const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const CHAT_MODEL = "gemini-3-8-flash-openai";

interface ChatOptions {
  userId: string;
  messages: Array<{ role: string; content: string }>;
}

export async function callAIProvider({ userId, messages }: ChatOptions): Promise<string> {
  const access = await resolveKieApiKeyForFeature(userId, { allowPaidPlatformKey: false });
  if (!access.apiKey) throw new Error("No KIE API key configured. Add your key in Settings.");

  const response = await fetch(`${KIE_BASE_URL}/${CHAT_MODEL}/v1/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${access.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: messages.map((message) => ({
      role: message.role === "system" || message.role === "assistant" ? message.role : "user",
      content: message.content,
    })) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.msg || `KIE chat failed (${response.status})`);
  const content = getKieResponseText(payload);
  if (!content) throw new Error("KIE chat returned empty result");
  return content;
}
