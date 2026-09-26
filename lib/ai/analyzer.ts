import { ANALYSIS_PROMPTS, extractCorePrompt } from "@/lib/ai/prompts";
import { DEFAULT_KIE_CHAT_MODEL, requestKieChat } from "@/lib/ai/kie-client";
import { defaultLocale, type Locale } from "@/i18n/config";


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
  const { frames, mode, outputLanguage = defaultLocale, apiKeyOverride, modelId = DEFAULT_KIE_CHAT_MODEL } = options;
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
    const result = await requestKieChat({ apiKey: apiKeyOverride, modelId, messages });
    return { success: true, prompt: result, corePrompt: extractCorePrompt(result) };
  } catch (error) {
    console.error("AI Analysis error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Analysis failed" };
  }
}
