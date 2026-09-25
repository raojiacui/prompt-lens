import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { retrySceneAnalysis } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
import { defaultLocale, isLocale } from "@/i18n/config";
import { db, operationLogs } from "@/lib/db";
import { releaseTrialAnalysis, reserveTrialAnalysis } from "@/lib/usage/trial-quota";
import { assertCanStartVideoAnalysis, settleVideoAnalysisCredits, type VideoAnalysisEntitlement, videoAnalysisBillingErrorResponse } from "@/lib/billing/video-analysis";

function shouldChargeCredits(entitlement: VideoAnalysisEntitlement) {
  return entitlement.mode === "platform_credits";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneVersionId: string }> },
) {
  let trialUserId: string | null = null;
  let trialCompleted = false;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true") return NextResponse.json({ code: "CONFIRMED_QUOTE_REQUIRED" }, { status: 409 });

  const { id, sceneVersionId } = await params;
  const body = await request.json().catch(() => null);

  try {
    const entitlement = await assertCanStartVideoAnalysis(session.user.id, 1);
    if (entitlement.mode === "trial") {
      await reserveTrialAnalysis(session.user.id);
      trialUserId = session.user.id;
    }
    const chargeCredits = shouldChargeCredits(entitlement);
    const scene = await retrySceneAnalysis({
      userId: session.user.id,
      projectId: id,
      sceneVersionId,
      outputLanguage: isLocale(body?.outputLanguage) ? body.outputLanguage : defaultLocale,
      allowPlatformKeyForAnalysis: entitlement.mode === "admin" || entitlement.mode === "platform_credits" || entitlement.mode === "trial",
      forceFreeTrialKie: entitlement.mode === "trial",
      ...parseWorkflowModelSelection(body),
    });
    const credits = await settleVideoAnalysisCredits({
      userId: session.user.id,
      entitlement,
      units: 1,
      note: "重新分析 1 个镜头",
      metadata: { projectId: id, sceneVersionId, feature: "scene_retry", analysisProvider: "kie" },
    });
    if (entitlement.mode === "trial") {
      await db.insert(operationLogs).values({ userId: session.user.id, action: "analysis.complete", resourceType: "video", resourceId: sceneVersionId, metadata: { billingMode: "trial", provider: "kie", feature: "scene_retry" } });
      trialCompleted = true;
    }
    return NextResponse.json({ scene, billing: { mode: entitlement.mode, chargedCredits: chargeCredits ? 1 : 0, balance: credits.balance } });
  } catch (error) {
    const billingError = videoAnalysisBillingErrorResponse(error);
    if (billingError) return NextResponse.json(billingError, { status: 402 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scene retry failed" }, { status: 500 });
  } finally {
    if (trialUserId && !trialCompleted) await releaseTrialAnalysis(trialUserId).catch((error) => console.error("Failed to release trial reservation:", error));
  }
}
