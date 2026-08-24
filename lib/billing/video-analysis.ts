import { isAdmin } from "@/lib/auth";
import { assertHasCredits, creditErrorResponse, deductCreditsFromUser, getCreditBalance } from "@/lib/billing/credits";
import { getPlatformKieApiKey, hasPaidPackageAccess, resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";
import { assertTrialQuota, getUserTrialUsage, trialQuotaResponse } from "@/lib/usage/trial-quota";

export const VIDEO_ANALYSIS_SHORT_MAX_SECONDS = 10;
export const VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS = 0.75;
export const VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS = 3;
export const VIDEO_ANALYSIS_PER_SCENE_CREDITS = 1;
export const FREE_TRIAL_ANALYSIS_PROVIDER = "openrouter";
export const FREE_TRIAL_ANALYSIS_MODEL = "google/gemini-2.5-flash";

export type VideoAnalysisBillingMode = "admin" | "byok" | "platform_credits" | "trial";

export type VideoAnalysisEntitlement = {
  mode: VideoAnalysisBillingMode;
  balance: number;
  hasPaidVideoAnalysis: boolean;
  hasUserKieKey: boolean;
  canUsePlatformKie: boolean;
  platformKieConfigured: boolean;
  trial: Awaited<ReturnType<typeof getUserTrialUsage>>;
  capabilities: {
    videoAnalysis: {
      shortVideoMaxSeconds: number;
      durationToleranceSeconds: number;
      canUseLongVideo: boolean;
      longVideoRequiresPayment: boolean;
      longVideoBaseCredits: number;
      perSceneCredits: number;
      canSelectAnalysisModel: boolean;
      freeTrialProvider: typeof FREE_TRIAL_ANALYSIS_PROVIDER;
      freeTrialModel: typeof FREE_TRIAL_ANALYSIS_MODEL;
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

function fallbackAdminTrialUsage(): Awaited<ReturnType<typeof getUserTrialUsage>> {
  const parsed = Number(process.env.TRIAL_USAGE_LIMIT || 2);
  const limit = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 2;
  return { limit, used: 0, remaining: Number.POSITIVE_INFINITY, isAdmin: true };
}

async function getAdminSafeCreditBalance(userId: string) {
  try {
    return await getCreditBalance(userId);
  } catch (error) {
    console.warn("[billing] Failed to load admin credit balance; continuing as unlimited admin:", error);
    return { userId, balance: 0, lifetimeGranted: 0, lifetimeUsed: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
  }
}
async function getSafeNonChargingBalance(userId: string, entitlement: VideoAnalysisEntitlement) {
  try {
    return await getCreditBalance(userId);
  } catch (error) {
    console.warn("[billing] Failed to load non-charging credit balance; returning entitlement balance:", error);
    return {
      userId,
      balance: entitlement.balance,
      lifetimeGranted: 0,
      lifetimeUsed: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

export async function getVideoAnalysisEntitlement(userId: string): Promise<VideoAnalysisEntitlement> {
  const adminUser = await isAdmin(userId);

  if (adminUser) {
    const [trial, credits] = await Promise.all([
      getUserTrialUsage(userId).catch(() => fallbackAdminTrialUsage()),
      getAdminSafeCreditBalance(userId),
    ]);

    return {
      mode: "admin",
      balance: credits.balance,
      hasPaidVideoAnalysis: true,
      hasUserKieKey: false,
      canUsePlatformKie: true,
      platformKieConfigured: Boolean(getPlatformKieApiKey()),
      trial: { ...trial, used: 0, remaining: Number.POSITIVE_INFINITY, isAdmin: true },
      capabilities: {
        videoAnalysis: {
          shortVideoMaxSeconds: VIDEO_ANALYSIS_SHORT_MAX_SECONDS,
          durationToleranceSeconds: VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS,
          canUseLongVideo: true,
          longVideoRequiresPayment: false,
          longVideoBaseCredits: VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS,
          perSceneCredits: VIDEO_ANALYSIS_PER_SCENE_CREDITS,
          canSelectAnalysisModel: true,
          freeTrialProvider: FREE_TRIAL_ANALYSIS_PROVIDER,
          freeTrialModel: FREE_TRIAL_ANALYSIS_MODEL,
        },
      },
    };
  }

  const [trial, credits, hasPaidVideoAnalysis, keyAccess] = await Promise.all([
    getUserTrialUsage(userId),
    getCreditBalance(userId),
    hasPaidPackageAccess(userId, ["video_analysis"]),
    resolveKieApiKeyForFeature(userId, { requiredPackageScope: "video_analysis" }),
  ]);

  const mode: VideoAnalysisBillingMode = keyAccess.hasUserKieKey
    ? "byok"
    : hasPaidVideoAnalysis
      ? "platform_credits"
      : "trial";
  const canUseLongVideo = hasPaidVideoAnalysis;
  const canUsePlatformKie = hasPaidVideoAnalysis;

  return {
    mode,
    balance: credits.balance,
    hasPaidVideoAnalysis,
    hasUserKieKey: keyAccess.hasUserKieKey,
    canUsePlatformKie,
    platformKieConfigured: Boolean(getPlatformKieApiKey()),
    trial,
    capabilities: {
      videoAnalysis: {
        shortVideoMaxSeconds: VIDEO_ANALYSIS_SHORT_MAX_SECONDS,
        durationToleranceSeconds: VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS,
        canUseLongVideo,
        longVideoRequiresPayment: !canUseLongVideo,
        longVideoBaseCredits: VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS,
        perSceneCredits: VIDEO_ANALYSIS_PER_SCENE_CREDITS,
        canSelectAnalysisModel: mode !== "trial",
        freeTrialProvider: FREE_TRIAL_ANALYSIS_PROVIDER,
        freeTrialModel: FREE_TRIAL_ANALYSIS_MODEL,
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

  if (entitlement.mode === "trial") {
    await assertTrialQuota(userId);
  }

  if (entitlement.mode === "platform_credits" || entitlement.mode === "trial") {
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
  if (params.entitlement.mode !== "platform_credits" && params.entitlement.mode !== "trial") return getSafeNonChargingBalance(params.userId, params.entitlement);
  return deductCreditsFromUser({
    userId: params.userId,
    amount: units,
    type: "feature_usage",
    note: params.note || `视频分析扣除 ${units} 积分`,
    metadata: {
      feature: "video_analysis",
      units,
      billingMode: params.entitlement.mode,
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
  return trialQuotaResponse(error) || creditErrorResponse(error);
}

