import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import axios from "axios";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MODEL_CONFIGS = {
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

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, resetIn } = checkRateLimit(
      session.user.id,
      RateLimitConfigs.analyze.limit,
      RateLimitConfigs.analyze.windowMs
    );

    if (!allowed) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { messages, provider = "deepseek" } = body as {
      messages: ChatMessage[];
      provider: "deepseek" | "zhipu" | "openrouter";
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 });
    }

    const config = MODEL_CONFIGS[provider];
    if (!config) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    // 获取 API Key
    const apiKey = getApiKeyForProvider(provider);
    if (!apiKey) {
      return NextResponse.json(
        { error: `${getProviderName(provider)} API key not configured` },
        { status: 500 }
      );
    }

    // 构建请求
    const chatMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await axios.post(
      config.url,
      {
        model: config.model,
        messages: chatMessages,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const content = response.data.choices?.[0]?.message?.content || "";

    return NextResponse.json({ content });
  } catch (error: any) {
    console.error("Agent chat error:", error);

    const errorMessage =
      error.response?.data?.error?.message ||
      error.message ||
      "Chat failed";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function getApiKeyForProvider(provider: string): string | undefined {
  switch (provider) {
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    case "zhipu":
      return process.env.ZHIPU_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    default:
      return undefined;
  }
}

function getProviderName(provider: string): string {
  switch (provider) {
    case "deepseek":
      return "DeepSeek";
    case "zhipu":
      return "智谱AI";
    case "openrouter":
      return "OpenRouter";
    default:
      return "Unknown";
  }
}
