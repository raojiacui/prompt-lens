import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runVideoBreakdown } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
import { defaultLocale, isLocale } from "@/i18n/config";
import { db, operationLogs } from "@/lib/db";
import { releaseTrialAnalysis, reserveTrialAnalysis } from "@/lib/usage/trial-quota";
import {
  assertCanStartVideoAnalysis,
  getVideoAnalysisChargeUnits,
  settleVideoAnalysisCredits,
  VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS,
  VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS,
  VIDEO_ANALYSIS_SHORT_MAX_SECONDS,
  type VideoAnalysisEntitlement,
  videoAnalysisBillingErrorResponse,
} from "@/lib/billing/video-analysis";

function shouldChargeCredits(entitlement: VideoAnalysisEntitlement) {
  return entitlement.mode === "platform_credits";
}

function canUsePlatformAnalysisKey(entitlement: VideoAnalysisEntitlement) {
  return entitlement.mode === "admin" || entitlement.mode === "platform_credits" || entitlement.mode === "trial";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let trialUserId: string | null = null;
  let trialCompleted = false;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  if (!mediaUrl) return NextResponse.json({ error: "Missing mediaUrl" }, { status: 400 });
  if (process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true" && body?.mediaType !== "image") return NextResponse.json({ code: "CONFIRMED_QUOTE_REQUIRED", error: "Confirm a server quote before starting analysis" }, { status: 409 });

  try {
    const mediaType = body?.mediaType === "image" ? "image" : "video";
    const mediaDuration = typeof body?.mediaDuration === "number" && Number.isFinite(body.mediaDuration) ? body.mediaDuration : undefined;
    const shortVideoLimit = VIDEO_ANALYSIS_SHORT_MAX_SECONDS + VIDEO_ANALYSIS_DURATION_TOLERANCE_SECONDS;
    const isShortSingleShotVideo = mediaType === "video" && body?.singleShot === true && typeof mediaDuration === "number" && mediaDuration <= shortVideoLimit;
    const isLongVideo = mediaType === "video" && !isShortSingleShotVideo;
    const minimumCredits = isLongVideo ? getVideoAnalysisChargeUnits({ sceneCount: 1, longVideo: true }) : 1;
    const entitlement = await assertCanStartVideoAnalysis(session.user.id, { minimumCredits, longVideo: isLongVideo });
    if (entitlement.mode === "trial") {
      await reserveTrialAnalysis(session.user.id);
      trialUserId = session.user.id;
    }
    const chargeCredits = shouldChargeCredits(entitlement);

    const { id } = await params;
    const bundle = await runVideoBreakdown({
      userId: session.user.id,
      projectId: id,
      mediaUrl,
      mediaName: typeof body?.mediaName === "string" ? body.mediaName : undefined,
      storageKey: typeof body?.storageKey === "string" ? body.storageKey : undefined,
      mediaType,
      mediaDuration,
      singleShot: isShortSingleShotVideo,
      outputLanguage: isLocale(body?.outputLanguage) ? body.outputLanguage : defaultLocale,
      creditBudget: chargeCredits ? { balance: entitlement.balance, baseUnits: isLongVideo ? VIDEO_ANALYSIS_LONG_VIDEO_BASE_CREDITS : 0 } : undefined,
      allowPlatformKeyForAnalysis: canUsePlatformAnalysisKey(entitlement),
      forceFreeTrialKie: entitlement.mode === "trial",
      ...parseWorkflowModelSelection(body),
    });
    if (!bundle) throw new Error("Video breakdown returned no project bundle");
    const sceneCount = Math.max(1, Array.isArray(bundle.sceneVersions) ? bundle.sceneVersions.length : 1);
    const units = getVideoAnalysisChargeUnits({ sceneCount, longVideo: isLongVideo });
    const credits = await settleVideoAnalysisCredits({
      userId: session.user.id,
      entitlement,
      units,
      note: isLongVideo ? `长视频自动拆镜分析 ${sceneCount} 个镜头` : `视频分析 ${sceneCount} 个镜头`,
      metadata: { projectId: id, mediaType, sceneCount, longVideo: isLongVideo, analysisProvider: "kie" },
    });
    if (entitlement.mode === "trial") {
      await db.insert(operationLogs).values({ userId: session.user.id, action: "analysis.complete", resourceType: mediaType, resourceId: id, metadata: { billingMode: "trial", provider: "kie", feature: "workflow_breakdown" } });
      trialCompleted = true;
    }
    return NextResponse.json({
      ...bundle,
      billing: { mode: entitlement.mode, chargedCredits: chargeCredits ? units : 0, balance: credits.balance, longVideo: isLongVideo },
    });
  } catch (error) {
    const billingError = videoAnalysisBillingErrorResponse(error);
    if (billingError) return NextResponse.json(billingError, { status: 402 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Breakdown failed" }, { status: 500 });
  } finally {
    if (trialUserId && !trialCompleted) await releaseTrialAnalysis(trialUserId).catch((error) => console.error("Failed to release trial reservation:", error));
  }
}
