import axios from "axios";
import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { decodeAnalyzeApiKey } from "@/lib/usage/trial-quota";
import { ANALYSIS_PROMPTS, extractCorePrompt } from "@/lib/ai/prompts";
import type { Locale } from "@/i18n/config";
import { defaultLocale } from "@/i18n/config";

// 代理配置（仅本地开发环境使用）
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
    console.log("[AI] Proxy enabled (local dev only):", axiosProxy);
  } catch {
    console.warn("[AI] Failed to parse proxy URL");
  }
}

// API 配置
const API_CONFIGS = {
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4v-plus",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
    model: "gemini-2.0-flash-exp",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemini-2.5-pro",
  },
};

// 环境变量中的 API Keys
const ENV_API_KEYS = {
  zhipu: process.env.ZHIPU_API_KEY || null,
  openrouter: process.env.OPENROUTER_API_KEY || null,
  gemini: process.env.GEMINI_API_KEY || null,
};

export type ApiProvider = "zhipu" | "gemini" | "openrouter";

export interface AnalyzeOptions {
  userId: string;
  provider?: ApiProvider;
  frames: string[]; // base64 编码的图片数组
  mode: "single" | "batch";
  /** AI 输出语言（默认 zh，影响生成结果的文本语言） */
  outputLanguage?: Locale;
}

export interface AnalyzeResult {
  success: boolean;
  prompt?: string;
  corePrompt?: string;
  error?: string;
}

/**
 * 获取 API Key - 优先使用用户配置，其次使用平台环境变量
 */
async function getUserApiKey(
  userId: string,
  provider: ApiProvider
): Promise<string | null> {
  const records = await db.query.userApiKeys.findMany({
    where: and(
      eq(userApiKeys.userId, userId),
      eq(userApiKeys.provider, provider),
      eq(userApiKeys.isActive, true)
    ),
    orderBy: [desc(userApiKeys.updatedAt), desc(userApiKeys.createdAt)],
  });

  for (const record of records) {
    const apiKey = decodeAnalyzeApiKey(record.apiKey);
    if (apiKey) {
      console.log(`[Analyzer] Using user API key for ${provider}`);
      return apiKey;
    }
  }

  const envKey = ENV_API_KEYS[provider];
  if (envKey) {
    console.log(`[Analyzer] Using env API key for ${provider}`);
    return envKey;
  }

  return null;
}

/**
 * 调用智谱AI API
 */
async function callZhipuApi(
  apiKey: string,
  messages: any[]
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const payload = {
    model: API_CONFIGS.zhipu.model,
    messages: messages,
    max_tokens: 4096,
    temperature: 0.7,
  };

  const response = await axios.post(API_CONFIGS.zhipu.url, payload, {
    headers,
    timeout: 180000,
    ...(axiosProxy ? { proxy: axiosProxy } : {}),
  });

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  const content = response.data.choices[0].message.content;
  if (!content) {
    const finishReason = response.data.choices[0].finish_reason;
    throw new Error(
      `API returned null content (finish_reason: ${finishReason}). The model may not support image input or rejected the request.`
    );
  }

  return content;
}

/**
 * 调用 Gemini API
 */
async function callGeminiApi(
  apiKey: string,
  images: string[],
  textPrompt: string
): Promise<string> {
  const contents = [];

  for (const img of images) {
    contents.push({
      role: "user",
      parts: [
        { inline_data: { mime_type: "image/jpeg", data: img.split(",")[1] } },
        { text: textPrompt },
      ],
    });
  }

  const payload = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
  };

  const url = `${API_CONFIGS.gemini.url}?key=${apiKey}`;
  const response = await axios.post(url, payload, {
    timeout: 180000,
    ...(axiosProxy ? { proxy: axiosProxy } : {}),
  });

  if (!response.data.candidates || response.data.candidates.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.candidates[0].content.parts[0].text;
}

/**
 * 调用 OpenRouter API
 */
async function callOpenRouterApi(
  apiKey: string,
  messages: any[]
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://prompt-analyzer.com",
    "X-Title": "Prompt Analyzer",
  };

  const payload = {
    model: API_CONFIGS.openrouter.model,
    messages: messages,
    max_tokens: 4096,
  };

  console.log("[OpenRouter] Request:", { url: API_CONFIGS.openrouter.url, model: API_CONFIGS.openrouter.model, keyPrefix: apiKey.substring(0, 10) });

  const response = await axios.post(API_CONFIGS.openrouter.url, payload, {
    headers,
    timeout: 180000,
    ...(axiosProxy ? { proxy: axiosProxy } : {}),
  });

  console.log("[OpenRouter] Response status:", response.status, response.data);

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}

/**
 * 分析图片/帧
 */
export async function analyzeFrames(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { userId, provider = "openrouter", frames, mode, outputLanguage = defaultLocale } = options;

  // 获取用户 API Key
  const apiKey = await getUserApiKey(userId, provider);

  if (!apiKey) {
    const envKeyConfigured = ENV_API_KEYS[provider] ? " (env configured)" : "";
    return {
      success: false,
      error: `No API key found for ${provider}${envKeyConfigured}. Please configure your API key in settings or check .env file.`,
    };
  }

  // 按用户选择的语言注入对应 prompt 模板
  const promptTemplate = ANALYSIS_PROMPTS[outputLanguage];
  const prompt = mode === "batch" ? promptTemplate.batch : promptTemplate.single;

  try {
    let result: string;

    if (provider === "zhipu") {
      // 智谱AI
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: frame },
            })),
          ],
        },
      ];
      result = await callZhipuApi(apiKey, messages);
    } else if (provider === "gemini") {
      // Gemini
      result = await callGeminiApi(apiKey, frames, prompt);
    } else {
      // OpenRouter (使用类似智谱的格式)
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: frame },
            })),
          ],
        },
      ];
      result = await callOpenRouterApi(apiKey, messages);
    }

    // 提取核心提示词（兼容中英文格式）
    const corePrompt = extractCorePrompt(result);

    return {
      success: true,
      prompt: result,
      corePrompt,
    };
  } catch (error: any) {
    console.error("AI Analysis error:", error);
    return {
      success: false,
      error: error.message || "Analysis failed",
    };
  }
}
