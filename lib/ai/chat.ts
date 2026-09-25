import { DEFAULT_KIE_CHAT_MODEL, requestKieChat } from "@/lib/ai/kie-client";
import { resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";


interface ChatOptions {
  userId: string;
  messages: Array<{ role: string; content: string }>;
}

export async function callAIProvider({ userId, messages }: ChatOptions): Promise<string> {
  const access = await resolveKieApiKeyForFeature(userId, { allowPaidPlatformKey: false });
  if (!access.apiKey) throw new Error("No KIE API key configured. Add your key in Settings.");

  return requestKieChat({
    apiKey: access.apiKey,
    modelId: DEFAULT_KIE_CHAT_MODEL,
    messages: messages.map((message) => ({
      role: message.role === "system" || message.role === "assistant" ? message.role : "user",
      content: message.content,
    })),
  });
}
