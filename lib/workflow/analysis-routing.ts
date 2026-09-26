export function requiresAnalysisQuote(input: {
  commercialEnabled: boolean;
  mediaType: "video" | "image";
  mode: string;
  longVideo: boolean;
  trialRemaining: number;
}) {
  if (!input.commercialEnabled || input.mediaType === "image" || input.mode === "admin") return false;
  if (!input.longVideo && input.mode === "byok") return false;
  if (!input.longVideo && input.mode === "trial" && input.trialRemaining > 0) return false;
  return true;
}
