import type { Locale } from "@/i18n/config";
import { isJsonHttpError } from "@/lib/http/json-client";
import { KieApiError } from "@/lib/ai/kie-chat-response";

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
  if (provider === "kie") {
    const status = error instanceof KieApiError ? Number(error.code) : isJsonHttpError(error) ? error.status : undefined;
    const message = error instanceof Error ? error.message : "";
    const missingInput = /(?:download|fileUri|image URL)[\s\S]*(?:404|Not Found)/i.test(message);
    const busy = !missingInput && ([408, 429, 500, 502, 503, 504, 524].includes(status ?? 0)
      || /KIE.*(?:timed?\s*out|timeout)/i.test(message)
      || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)));
    if (busy) return locale === "en"
      ? "The KIE upstream gateway is busy. No analysis result was received. Try switching to another model."
      : "由于 KIE 上游网关问题，服务暂时繁忙，本次未获取到分析结果。可以切换其他模型试试。";
  }
  if (isJsonHttpError(error)) {
    const status = error.status;
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
