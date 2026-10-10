export function requiresAnalysisQuote(input: {
  commercialEnabled: boolean;
  mediaType: "video" | "image";
  mode: string;
  automaticSplit?: boolean;
  trialRemaining: number;
}) {
  if (!input.commercialEnabled || input.mediaType === "image") return false;
  if (input.automaticSplit) return true;
  if (input.mode === "admin" || input.mode === "byok") return false;
  if (input.mode === "trial" && input.trialRemaining > 0) return false;
  return true;
}
