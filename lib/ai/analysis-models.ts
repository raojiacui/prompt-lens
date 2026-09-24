export const ANALYSIS_MODELS = [
  {
    id: "platform-gemini-3.5-flash",
    provider: "kie",
    providerModel: "gemini-3-5-flash-thinking",
    keySource: "platform",
  },
  {
    id: "kie-gemini-3.5-flash",
    provider: "kie",
    providerModel: "gemini-3-5-flash-thinking",
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

export const DEFAULT_ANALYSIS_MODEL_ID: AnalysisModelId = "platform-gemini-3.5-flash";

// KIE channel paths are not interchangeable with request model names.
export function getKieAnalysisPath(model: string): string {
  if (model === "gemini-3-5-flash-thinking") return "/gemini-3-5-flash-openai/v1/chat/completions";
  if (model === "gemini-2.5-pro") return "/gemini-2.5-pro/v1/chat/completions";
  throw new Error(`Unsupported KIE analysis model: ${model}`);
}

export function resolveAnalysisModel(modelId: unknown): AnalysisModel | null {
  if (typeof modelId !== "string") return null;
  // Keep already-open clients working after the retired Flash channel is replaced.
  if (modelId === "platform-gemini-2.5-flash") modelId = DEFAULT_ANALYSIS_MODEL_ID;
  if (modelId === "kie-gemini-2.5-flash") modelId = "kie-gemini-3.5-flash";
  return ANALYSIS_MODELS.find((model) => model.id === modelId) || null;
}

export function resolveLegacyAnalysisProvider(provider: unknown): AnalysisModel | null {
  if (provider === "kie") return resolveAnalysisModel("kie-gemini-3.5-flash");
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
