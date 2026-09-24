import axios from "axios";
import type { Locale } from "@/i18n/config";

type AnalysisProvider = "zhipu" | "gemini" | "openrouter" | "kie";

const PROVIDER_NAMES: Record<AnalysisProvider, string> = {
  zhipu: "Zhipu",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  kie: "KIE",
};

export function describeAnalysisProviderError(
  provider: AnalysisProvider,
  error: unknown,
  locale: Locale = "zh",
): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const name = PROVIDER_NAMES[provider];

    if (status === 401 || status === 403) {
      if (locale === "en") {
        return provider === "kie"
          ? "KIE rejected this API key. Check whether the key is valid and whether its permissions or IP allowlist permit the production server."
          : `${name} rejected the API key. Check or replace the key and try again.`;
      }

      return provider === "kie"
        ? "KIE API Key 校验失败。请检查 Key 是否有效，以及权限或 IP 白名单是否允许线上服务器访问。"
        : `${name} API Key 校验失败，请检查或更换 Key 后重试。`;
    }

    if (status === 429) {
      return locale === "en"
        ? `${name} is rate limiting requests. Please try again later.`
        : `${name} 请求过于频繁，请稍后再试。`;
    }
  }

  return error instanceof Error ? error.message : "Analysis failed";
}
