import { ANALYSIS_PROMPTS, extractCorePrompt } from "@/lib/ai/prompts";
import { getKieResponseText } from "@/lib/ai/kie-response";
import { defaultLocale, type Locale } from "@/i18n/config";

const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const DEFAULT_ANALYSIS_MODEL = "gemini-3-8-flash-openai";

export function resolveAnalysisProviderForBillingMode(_mode: string): "kie" {
  return "kie";
}

export interface AnalyzeOptions {
  userId: string;
  provider?: "kie";
  frames: string[];
  mode: "single" | "batch";
  outputLanguage?: Locale;
  apiKeyOverride: string;
  modelId?: string;
}

export interface AnalyzeResult {
  success: boolean;
  prompt?: string;
  corePrompt?: string;
  error?: string;
}

export async function analyzeFrames(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { frames, mode, outputLanguage = defaultLocale, apiKeyOverride, modelId = DEFAULT_ANALYSIS_MODEL } = options;
  const promptTemplate = ANALYSIS_PROMPTS[outputLanguage];
  const prompt = mode === "batch" ? promptTemplate.batch : promptTemplate.single;
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: prompt },
      ...frames.map((frame) => ({ type: "image_url", image_url: { url: frame } })),
    ],
  }];

  try {
    const response = await fetch(`${KIE_BASE_URL}/${modelId}/v1/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${apiKeyOverride}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.msg || `KIE API error (${response.status})`;
      throw new Error(detail);
    }
    const result = getKieResponseText(payload);
    if (!result) throw new Error("KIE Gemini API returned empty result");
    return { success: true, prompt: result, corePrompt: extractCorePrompt(result) };
  } catch (error) {
    console.error("AI Analysis error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Analysis failed" };
  }
}
