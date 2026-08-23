import { and, eq, isNotNull } from "drizzle-orm";
import { isAdmin } from "@/lib/auth";
import { assertHasCredits, creditErrorResponse, deductCreditsFromUser, getCreditBalance } from "@/lib/billing/credits";
import { creditLedger, db } from "@/lib/db";
import { getUserTrialUsage } from "@/lib/usage/trial-quota";

export const VIDEO_ANALYSIS_SHORT_MAX_SECONDS = 10;
export const VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS = 0.75;
export const VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS = 3;
export const VIDEO_ANALYSIS_PER_SCENE_CREDITS = 1;

export type VideoAnalysisEntitlement = {
  mode: "admin" | "credits";
  balance: number;
  hasPaidVideoAnalysis: boolean;
  trial: Awaited<ReturnType<typeof getUserTrialUsage>>;
  capabilities: {
    videoAnalysis: {
      shortVideoMaxSeconds: number;
      durationToleranceSeconds: number;
      canUseLongVideo: boolean;
      longVideoRequiresPayment: boolean;
      longVideoBaseCredits: number;
      perSceneCredits: number;
    };
  };
};

export class LongVideoAccessError extends Error {
  status = 402;

  constructor() {
    super("长视频自动拆镜分析需要先购买积分包。免费体验和未付费账号仅支持 10 秒以内完整镜头片段。");
    this.name = "LongVideoAccessError";
  }
}

async function hasPaidVideoAnalysisLedger(userId: string) {
  const row = await db.query.creditLedger.findFirst({
    where: and(eq(creditLedger.userId, userId), isNotNull(creditLedger.packageId)),
  });
  return Boolean(row);
}

export async function getVideoAnalysisEntitlement(userId: string): Promise<VideoAnalysisEntitlement> {
  const [adminUser, trial, credits, hasPaidVideoAnalysis] = await Promise.all([
    isAdmin(userId),
    getUserTrialUsage(userId),
    getCreditBalance(userId),
    hasPaidVideoAnalysisLedger(userId),
  ]);

  const isAdminUser = adminUser || trial.isAdmin;
  const mode = isAdminUser ? "admin" : "credits";
  const canUseLongVideo = isAdminUser || hasPaidVideoAnalysis;

  return {
    mode,
    balance: credits.balance,
    hasPaidVideoAnalysis,
    trial,
    capabilities: {
      videoAnalysis: {
        shortVideoMaxSeconds: VIDEO_ANALYSIS_SHORT_MAX_SECONDS,
        durationToleranceSeconds: VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS,
        canUseLongVideo,
        longVideoRequiresPayment: !canUseLongVideo,
        longVideoBaseCredits: VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS,
        perSceneCredits: VIDEO_ANALYSIS_PER_SCENE_CREDITS,
      },
    },
  };
}

export async function assertCanStartVideoAnalysis(userId: string, options: number | { minimumCredits?: number; longVideo?: boolean } = 1) {
  const minimumCredits = typeof options === "number" ? options : options.minimumCredits ?? 1;
  const longVideo = typeof options === "number" ? false : options.longVideo === true;
  const entitlement = await getVideoAnalysisEntitlement(userId);

  if (longVideo && !entitlement.capabilities.videoAnalysis.canUseLongVideo) {
    throw new LongVideoAccessError();
  }

  if (entitlement.mode === "credits") {
    await assertHasCredits(userId, minimumCredits);
  }
  return entitlement;
}

export function getVideoAnalysisChargeUnits(params: { sceneCount: number; longVideo?: boolean }) {
  const sceneCount = Math.max(1, Math.floor(params.sceneCount || 1));
  return (params.longVideo ? VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS : 0) + sceneCount * VIDEO_ANALYSIS_PER_SCENE_CREDITS;
}

export async function settleVideoAnalysisCredits(params: {
  userId: string;
  entitlement: VideoAnalysisEntitlement;
  units: number;
  note?: string;
  metadata?: Record<string, unknown>;
}) {
  const units = Math.max(1, Math.floor(params.units || 1));
  if (params.entitlement.mode !== "credits") return getCreditBalance(params.userId);
  return deductCreditsFromUser({
    userId: params.userId,
    amount: units,
    type: "feature_usage",
    note: params.note || `视频分析扣除 ${units} 积分`,
    metadata: {
      feature: "video_analysis",
      units,
      ...(params.metadata || {}),
    },
  });
}

export function videoAnalysisBillingErrorResponse(error: unknown) {
  if (error instanceof LongVideoAccessError) {
    return {
      error: error.message,
      code: "LONG_VIDEO_PAYMENT_REQUIRED",
    };
  }
  return creditErrorResponse(error);
}