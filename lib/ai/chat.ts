import { DEFAULT_KIE_CHAT_MODEL } from "@/lib/ai/kie-client";
import { requestProviderChat } from "./provider-client";
import { resolveApiKeyForFeature } from "@/lib/billing/platform-access";


interface ChatOptions {
  userId: string;
  messages: Array<{ role: string; content: string }>;
}

export async function callAIProvider({ userId, messages }: ChatOptions) {
  const access = await resolveApiKeyForFeature(userId, { allowPaidPlatformKey: false });
  if (!access.apiKey) throw new Error("No API key configured. Add your key in Settings.");

  const content = await requestProviderChat({
    provider: access.provider,
    apiKey: access.apiKey,
    modelId: DEFAULT_KIE_CHAT_MODEL,
    messages: messages.map((message) => ({
      role: message.role === "system" || message.role === "assistant" ? message.role : "user",
      content: message.content,
    })),
  });
  return { content, provider: access.provider };
}
