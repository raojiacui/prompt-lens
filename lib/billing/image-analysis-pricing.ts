// Dedicated immutable image tariff; video and generation snapshots are unchanged.
export const IMAGE_ANALYSIS_PRICING_VERSION = "2026-11-28-image-v3";
export const IMAGE_ANALYSIS_PRICES = {
  "analysis-deepseek-v4-1-flash": { credits: 2, inputUsdPerMillion: 0.12, outputUsdPerMillion: 0.475, inputTokens: 16384, outputTokens: 16384 },
  "analysis-gemini-3-6-flash": { credits: 4, inputUsdPerMillion: 0.45, outputUsdPerMillion: 2.25, inputTokens: 16384, outputTokens: 8192 },
} as const;
export function imageAnalysisPrice(modelId: string) {
  if (!Object.hasOwn(IMAGE_ANALYSIS_PRICES, modelId)) throw new Error("IMAGE_MODEL_NOT_PRICED");
  const price = IMAGE_ANALYSIS_PRICES[modelId as keyof typeof IMAGE_ANALYSIS_PRICES];
  if (!price) throw new Error("IMAGE_MODEL_NOT_PRICED");
  return { ...price, modelId, version: IMAGE_ANALYSIS_PRICING_VERSION, imageCount: 1 };
}

export function imageAnalysisCostBudget(modelId: string) {
  const price = imageAnalysisPrice(modelId);
  // Rates in micro-USD/M; 7.5 CNY/USD * 1.2 contingency = 9.
  const tokenCost = BigInt(price.inputTokens) * BigInt(Math.round(price.inputUsdPerMillion * 1e6))
    + BigInt(price.outputTokens) * BigInt(Math.round(price.outputUsdPerMillion * 1e6));
  const budgetMicroCny = (tokenCost * 9n + 999999n) / 1000000n + 30000n;
  // Lowest package yield: CNY199/1500. Reserve 6% fees and 30% contribution.
  const numerator = budgetMicroCny * 1500n * 100n;
  const denominator = 199000000n * 64n;
  return { budgetMicroCny: Number(budgetMicroCny), requiredCredits: Number((numerator + denominator - 1n) / denominator) };
}
