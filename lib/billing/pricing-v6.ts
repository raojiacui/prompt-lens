// Price snapshots are immutable. Legacy credits must not use these rates.
export const PRICING_VERSION = "2026-09-14-v6";
export const COMMERCIAL_PACKAGES = [
  { id: "v6_trial_200", name: "体验包", priceCents: 1990, credits: 200, rewrites: 20 },
  { id: "v6_creator_650", name: "创作包", priceCents: 5900, credits: 650, rewrites: 60 },
  { id: "v6_volume_1500", name: "大容量包", priceCents: 12900, credits: 1500, rewrites: 150 },
] as const;

export type AnalysisModel = "flash" | "pro";
export type BillingPayer = "platform" | "byok" | "byok_split";
export type SceneInterval = { id: string; startUs: number; endUs: number };
export type AnalysisPriceInput = {
  payer: BillingPayer;
  model: AnalysisModel;
  sourceDurationUs: number;
  automaticSplit: boolean;
  paidSplitReusable: boolean;
  scenes: readonly SceneInterval[];
};

function integer(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error("Invalid billing quantity");
  return value;
}

function ceilRatio(numerator: bigint, denominator: bigint) {
  return Number((numerator + denominator - 1n) / denominator);
}

export function splitCredits(durationUs: number) {
  return ceilRatio(BigInt(integer(durationUs, 1)), 6_000_000n);
}

function validateAnalysis(input: AnalysisPriceInput) {
  integer(input.sourceDurationUs, 1);
  if (!["platform", "byok", "byok_split"].includes(input.payer)) throw new Error("Invalid payer");
  if (!["flash", "pro"].includes(input.model)) throw new Error("Invalid analysis model");
  if (input.sourceDurationUs > 60_000_000 || input.scenes.length > 20) throw new Error("Analysis launch limit exceeded");
  if (!input.scenes.length) throw new Error("Select at least one scene");
  if (input.payer === "byok" && input.automaticSplit) throw new Error("Automatic split requires paid service");
  if (input.payer === "byok_split" && !input.automaticSplit) throw new Error("Split payer requires automatic split");
  if (!input.automaticSplit && (input.scenes.length !== 1 || input.paidSplitReusable)) throw new Error("Invalid manual upload");
  const ids = new Set<string>();
  let end = 0;
  for (const scene of [...input.scenes].sort((a, b) => a.startUs - b.startUs)) {
    integer(scene.startUs);
    integer(scene.endUs, 1);
    if (!scene.id || ids.has(scene.id) || scene.startUs < end || scene.endUs <= scene.startUs || scene.endUs > input.sourceDurationUs) {
      throw new Error("Invalid or overlapping scene interval");
    }
    ids.add(scene.id);
    end = scene.endUs;
  }
  if (!input.automaticSplit && (input.scenes[0].startUs !== 0 || input.scenes[0].endUs !== input.sourceDurationUs)) {
    throw new Error("Manual upload must quote the complete file");
  }
}

/** Use only server-probed durations and server-owned paid asset records. */
export function quoteAnalysis(input: AnalysisPriceInput) {
  validateAnalysis(input);
  const split = input.automaticSplit && !input.paidSplitReusable ? splitCredits(input.sourceDurationUs) : 0;
  const durationUs = input.scenes.reduce((total, scene) => total + scene.endUs - scene.startUs, 0);
  const sceneFee = input.model === "flash" ? input.scenes.length : 2 * input.scenes.length;
  const durationFee = input.model === "flash"
    ? ceilRatio(2n * BigInt(durationUs), 5_000_000n)
    : ceilRatio(BigInt(durationUs), 2_000_000n);
  const analysis = input.payer === "platform" ? sceneFee + durationFee : 0;
  return { version: PRICING_VERSION, credits: split + analysis, splitCredits: split, analysisCredits: analysis, durationUs, sceneCount: input.scenes.length };
}

/** Cumulative settlement prevents per-scene rounding and repeat split charges on retry. */
export function settleAnalysis(input: AnalysisPriceInput, successfulIds: readonly string[], splitDelivered: boolean) {
  const quote = quoteAnalysis(input);
  const ids = new Set(successfulIds);
  if (ids.size !== successfulIds.length || successfulIds.some((id) => !input.scenes.some((scene) => scene.id === id))) throw new Error("Invalid successful scenes");
  if (input.automaticSplit && ids.size && !splitDelivered) throw new Error("Split assets not delivered");
  if (input.payer === "byok_split") return splitDelivered ? quote.splitCredits : 0;
  if (input.payer === "byok" || ids.size === 0) return 0;
  return quoteAnalysis({ ...input, scenes: input.scenes.filter((scene) => ids.has(scene.id)) }).credits;
}

export function retryAnalysisCredits(input: AnalysisPriceInput, previousIds: readonly string[], cumulativeIds: readonly string[]) {
  if (previousIds.some((id) => !cumulativeIds.includes(id))) throw new Error("Successful scenes cannot be removed");
  return settleAnalysis(input, cumulativeIds, true) - settleAnalysis(input, previousIds, true);
}

export type GenerationPriceInput = {
  modelId: string;
  resolution: string;
  durationSeconds: number;
  audio: boolean;
  referenceVideoSeconds?: number;
};

/** Public-price estimate only; adapters still require paid-call acceptance before enabling. */
export function estimateGeneration(input: GenerationPriceInput) {
  const seconds = integer(input.durationSeconds, 1);
  const reference = input.referenceVideoSeconds;
  if (reference !== undefined) integer(reference, 1);
  let microUsdPerSecond = 0;
  const { modelId, resolution, audio } = input;
  if (modelId === "grok-imagine/text-to-video" && resolution === "720p" && [6, 10].includes(seconds) && reference === undefined && !audio) microUsdPerSecond = 22500;
  if (["wan/2-6-text-to-video", "wan/2-6-image-to-video"].includes(modelId) && resolution === "720p" && [5, 10].includes(seconds) && reference === undefined && !audio) microUsdPerSecond = 70000;
  if (modelId === "kling-2.6/text-to-video" && resolution === "1080p" && [5, 10].includes(seconds) && reference === undefined) microUsdPerSecond = audio ? 110000 : 55000;
  if (modelId === "kling-3.0/video" && ["720p", "1080p"].includes(resolution) && [5, 10].includes(seconds) && reference === undefined) {
    microUsdPerSecond = resolution === "720p" ? (audio ? 100000 : 70000) : (audio ? 135000 : 90000);
  }
  if ([5, 10].includes(seconds)) {
    if (modelId === "bytedance/seedance-2-mini" && !audio && reference === undefined) {
      microUsdPerSecond = resolution === "480p" ? 19000 : resolution === "720p" ? 41000 : 0;
    }
    if (modelId === "bytedance/seedance-2-fast" && resolution === "720p") microUsdPerSecond = reference === undefined ? 124000 : 75000;
    if (modelId === "bytedance/seedance-2") {
      microUsdPerSecond = resolution === "720p" ? (reference === undefined ? 205000 : 125000)
        : resolution === "1080p" ? (reference === undefined ? 510000 : 310000) : 0;
    }
  }
  if (!microUsdPerSecond) throw new Error("MODEL_PRICE_UNVERIFIED");
  const microUsd = BigInt(microUsdPerSecond) * (BigInt(seconds) + BigInt(reference ?? 0));
  // USD * 7.5 * 1.2 + CNY 0.15; each 5 credits budgets CNY 0.175.
  const credits = 5 * ceilRatio(microUsd * 9n + 150000n, 175000n);
  if (!Number.isSafeInteger(credits)) throw new Error("Generation price overflow");
  return { version: PRICING_VERSION, credits, microUsd: Number(microUsd), adapterVerified: false as const };
}
