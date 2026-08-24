import { creditErrorResponse, deductCreditsFromUser, getCreditBalance, assertHasCredits } from "@/lib/billing/credits";
import type { ResolvedKieApiKey } from "@/lib/billing/platform-access";
import { getModelById } from "@/lib/ai/model-registry";

const MIN_GENERATION_CREDITS = 12;

function normalizedDurationSeconds(value: unknown) {
  const duration = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 10;
  return Math.max(4, duration || 10);
}

export function getVideoGenerationChargeUnits(params: { modelId?: string | null; duration?: number | null }) {
  const modelId = params.modelId || "";
  const model = modelId ? getModelById(modelId) : null;
  const duration = normalizedDurationSeconds(params.duration);
  const searchableId = `${model?.id || ""} ${model?.kieModelId || modelId}`.toLowerCase();

  if (model?.category === "video_edit") return 30;
  if (searchableId.includes("veo")) return 24;
  if (searchableId.includes("sora-2")) return Math.max(30, Math.ceil(duration * 3));
  if (searchableId.includes("kling")) return Math.max(18, Math.ceil(duration * 1.8));
  if (searchableId.includes("seedance")) return Math.max(16, Math.ceil(duration * 1.6));
  if (searchableId.includes("wan")) return Math.max(MIN_GENERATION_CREDITS, Math.ceil(duration * 1.3));

  const costLevel = model?.costLevel || 3;
  if (costLevel >= 5) return Math.max(30, Math.ceil(duration * 3));
  if (costLevel >= 4) return Math.max(24, Math.ceil(duration * 2.4));
  if (costLevel >= 3) return Math.max(16, Math.ceil(duration * 1.6));
  return Math.max(MIN_GENERATION_CREDITS, Math.ceil(duration * 1.2));
}

export async function assertCanUseVideoGenerationCredits(params: {
  userId: string;
  keyAccess: ResolvedKieApiKey;
  units: number;
}) {
  if (params.keyAccess.source === "platform_paid") {
    await assertHasCredits(params.userId, params.units);
  }
}

export async function settleVideoGenerationCredits(params: {
  userId: string;
  keyAccess: ResolvedKieApiKey;
  units: number;
  note?: string;
  metadata?: Record<string, unknown>;
}) {
  const units = Math.max(1, Math.floor(params.units || 1));
  if (params.keyAccess.source !== "platform_paid") return getCreditBalance(params.userId);
  return deductCreditsFromUser({
    userId: params.userId,
    amount: units,
    type: "feature_usage",
    note: params.note || `视频生成扣除 ${units} 积分`,
    metadata: {
      feature: "video_generation",
      units,
      keySource: params.keyAccess.source,
      ...(params.metadata || {}),
    },
  });
}

export function videoGenerationBillingErrorResponse(error: unknown) {
  return creditErrorResponse(error);
}
