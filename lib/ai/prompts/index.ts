import type { Locale } from "@/i18n/config";
import {
  SINGLE_ANALYSIS_PROMPT_ZH,
  BATCH_ANALYSIS_PROMPT_ZH,
} from "./zh";
import {
  SINGLE_ANALYSIS_PROMPT_EN,
  BATCH_ANALYSIS_PROMPT_EN,
} from "./en";

export interface AnalysisPrompts {
  single: string;
  batch: string;
}

export const ANALYSIS_PROMPTS: Record<Locale, AnalysisPrompts> = {
  zh: {
    single: SINGLE_ANALYSIS_PROMPT_ZH,
    batch: BATCH_ANALYSIS_PROMPT_ZH,
  },
  en: {
    single: SINGLE_ANALYSIS_PROMPT_EN,
    batch: BATCH_ANALYSIS_PROMPT_EN,
  },
};

/**
 * 从 AI 返回结果中提取核心提示词。
 * 同时兼容中文"核心提示词："和英文"Core Prompt:"两种格式。
 */
export function extractCorePrompt(result: string): string {
  if (!result || typeof result !== "string") {
    return "";
  }
  const match = result.match(/(?:核心提示词|Core Prompt)\s*[：:]\s*([^\n]+)/i);
  if (match) {
    return match[1].trim();
  }

  // 如果没有找到，返回第一行非空内容
  const lines = result.split("\n").filter((l) => l.trim());
  return lines[0]?.trim() || "";
}
