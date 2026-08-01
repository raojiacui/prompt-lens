import axios from "axios";
import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";

// 代理配置
const isLocalDev = process.env.NODE_ENV === "development";
const proxyUrl = isLocalDev ? (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897") : undefined;

let axiosProxy: { host: string; port: number; protocol: string } | undefined = undefined;
if (proxyUrl) {
  try {
    const url = new URL(proxyUrl);
    axiosProxy = {
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === "https:" ? 443 : 80),
      protocol: url.protocol.replace(":", ""),
    };
  } catch {
    console.warn("[Chat] Failed to parse proxy URL");
  }
}

// API 配置
const API_CONFIGS = {
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-3-haiku",
  },
};

// 环境变量中的 API Keys
const ENV_API_KEYS = {
  deepseek: process.env.DEEPSEEK_API_KEY || null,
  zhipu: process.env.ZHIPU_API_KEY || null,
  openrouter: process.env.OPENROUTER_API_KEY || null,
};

export type ChatProvider = "deepseek" | "zhipu" | "openrouter";

interface ChatOptions {
  userId: string;
  provider: ChatProvider;
  messages: Array<{ role: string; content: string }>;
}

/**
 * 获取 API Key
 * 注意：deepseek 只支持环境变量，不存储在数据库
 */
async function getApiKey(userId: string, provider: ChatProvider): Promise<string | null> {
  // deepseek 不支持数据库存储，直接使用环境变量
  if (provider === "deepseek") {
    const envKey = ENV_API_KEYS[provider];
    if (envKey) {
      console.log(`[Chat] Using env API key for ${provider}`);
      return envKey;
    }
    return null;
  }

  // 优先从数据库读取用户配置的 API Key (仅支持 zhipu/gemini/openrouter)
  const result = await db.query.userApiKeys.findFirst({
    where: and(
      eq(userApiKeys.userId, userId),
      eq(userApiKeys.provider, provider as "zhipu" | "gemini" | "openrouter")
    ),
  });

  if (!result || !result.isActive) {
    const envKey = ENV_API_KEYS[provider];
    if (envKey) {
      console.log(`[Chat] Using env API key for ${provider}`);
      return envKey;
    }
    return null;
  }

  try {
    if (isValidEncryptedKey(result.apiKey)) {
      return decryptApiKey(result.apiKey);
    }
    return result.apiKey;
  } catch (error) {
    console.error(`[Chat] Failed to decrypt API key for ${provider}:`, error);
    const envKey = ENV_API_KEYS[provider];
    if (envKey) {
      console.log(`[Chat] Using env API key for ${provider}`);
      return envKey;
    }
    return null;
  }
}

/**
 * 调用 AI 提供商
 */
export async function callAIProvider(options: ChatOptions): Promise<string> {
  const { userId, provider, messages } = options;

  const apiKey = await getApiKey(userId, provider);
  if (!apiKey) {
    const envConfigured = ENV_API_KEYS[provider] ? ` (env: ${provider})` : "";
    throw new Error(`No API key configured for ${provider}${envConfigured}. Please set API key in settings.`);
  }

  const config = API_CONFIGS[provider];

  // 转换消息格式
  const formattedMessages = messages.map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : "user",
    content: msg.content,
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://prompt-lens.cc.cd";
    headers["X-Title"] = "Prompt Lens";
  }

  if (provider !== "zhipu") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const payload = {
    model: config.model,
    messages: formattedMessages,
    max_tokens: 4096,
    temperature: 0.7,
  };

  if (provider === "zhipu") {
    (payload as any).secret_key = apiKey;
  }

  console.log(`[Chat] Calling ${provider}:`, { url: config.url, model: config.model });

  const response = await axios.post(config.url, payload, {
    headers,
    timeout: 120000,
    ...(axiosProxy ? { proxy: axiosProxy } : {}),
  });

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}
