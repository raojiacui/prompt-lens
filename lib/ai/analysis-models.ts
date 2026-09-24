export const ANALYSIS_MODELS = [
  {
    id: "platform-gemini-2.5-flash",
    provider: "kie",
    providerModel: "gemini-2.5-flash",
    keySource: "platform",
  },
  {
    id: "kie-gemini-2.5-flash",
    provider: "kie",
    providerModel: "gemini-2.5-flash",
    keySource: "user",
  },
  {
    id: "kie-gemini-2.5-pro",
    provider: "kie",
    providerModel: "gemini-2.5-pro",
    keySource: "user",
  },
] as const;

export type AnalysisModel = (typeof ANALYSIS_MODELS)[number];
export type AnalysisModelId = AnalysisModel["id"];

export const DEFAULT_ANALYSIS_MODEL_ID: AnalysisModelId = "platform-gemini-2.5-flash";

export function resolveAnalysisModel(modelId: unknown): AnalysisModel | null {
  if (typeof modelId !== "string") return null;
  return ANALYSIS_MODELS.find((model) => model.id === modelId) || null;
}

export function resolveLegacyAnalysisProvider(provider: unknown): AnalysisModel | null {
  if (provider === "kie") return resolveAnalysisModel("kie-gemini-2.5-flash");
  if (provider === "openrouter" || provider == null) {
    return resolveAnalysisModel(DEFAULT_ANALYSIS_MODEL_ID);
  }
  return null;
}

export function resolvePlatformAnalysisApiKey(
  env: { KIE_AI_API_KEY?: string; KIE_API_KEY?: string } = process.env as {
    KIE_AI_API_KEY?: string;
    KIE_API_KEY?: string;
  },
): string | null {
  return env.KIE_AI_API_KEY?.trim() || env.KIE_API_KEY?.trim() || null;
}
