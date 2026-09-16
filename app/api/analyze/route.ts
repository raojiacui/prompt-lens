import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory, operationLogs } from "@/lib/db";
import { analyzeFrames, ApiProvider } from "@/lib/ai/analyzer";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { defaultLocale, isLocale } from "@/i18n/config";
import { assertCanStartVideoAnalysis, settleVideoAnalysisCredits, type VideoAnalysisEntitlement, videoAnalysisBillingErrorResponse } from "@/lib/billing/video-analysis";

function shouldChargeCredits(entitlement: VideoAnalysisEntitlement) {
  return entitlement.mode === "platform_credits" || entitlement.mode === "trial";
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { allowed, resetIn } = checkRateLimit(
      userId,
      RateLimitConfigs.analyze.limit,
      RateLimitConfigs.analyze.windowMs
    );

    if (!allowed) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) },
        { status: 429 }
      );
    }

    const body = await request.json();
    if (process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true" && body?.mediaType === "video") return NextResponse.json({ code: "CONFIRMED_QUOTE_REQUIRED" }, { status: 409 });
    const {
      mediaUrl,
      mediaType,
      frames: clientFrames,
      analyzeMode = "single",
      provider = "openrouter",
      outputLanguage,
    } = body;

    if (!mediaUrl || !mediaType) {
      return NextResponse.json({ error: "Missing mediaUrl or mediaType" }, { status: 400 });
    }

    const resolvedLanguage = isLocale(outputLanguage) ? outputLanguage : defaultLocale;
    const frames: string[] = Array.isArray(clientFrames) ? clientFrames : [];

    if (frames.length === 0) {
      return NextResponse.json(
        { error: "Please refresh the page and try again" },
        { status: 400 }
      );
    }

    const entitlement = await assertCanStartVideoAnalysis(session.user.id, 1);
    const chargeCredits = shouldChargeCredits(entitlement);
    const resolvedProvider: ApiProvider = entitlement.mode === "trial" ? "openrouter" : (provider as ApiProvider);

    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.start",
      resourceType: mediaType,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider: resolvedProvider, billingMode: entitlement.mode },
    });

    const result = await analyzeFrames({
      userId: session.user.id,
      provider: resolvedProvider,
      frames,
      mode: analyzeMode as "single" | "batch",
      outputLanguage: resolvedLanguage,
    });

    if (!result.success) {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "analysis.error",
        resourceType: mediaType,
        metadata: { error: result.error, mediaUrl, provider: resolvedProvider },
      });
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const historyRecord = await db.insert(analysisHistory).values({
      userId: session.user.id,
      mediaType,
      mediaUrl,
      mediaName: mediaUrl.split("/").pop(),
      frameCount: frames.length,
      analyzeMode,
      prompt: result.prompt!,
      corePrompt: result.corePrompt!,
      language: resolvedLanguage,
    }).returning();

    const credits = await settleVideoAnalysisCredits({
      userId: session.user.id,
      entitlement,
      units: 1,
      note: "视频分析 1 个镜头",
      metadata: { historyId: historyRecord[0].id, mediaType, analyzeMode, provider: resolvedProvider },
    });

    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: mediaType,
      resourceId: historyRecord[0].id,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider: resolvedProvider, billingMode: entitlement.mode },
    });

    return NextResponse.json({
      success: true,
      prompt: result.prompt,
      corePrompt: result.corePrompt,
      historyId: historyRecord[0].id,
      billing: { mode: entitlement.mode, chargedCredits: chargeCredits ? 1 : 0, balance: credits.balance },
    });
  } catch (error: unknown) {
    const billingError = videoAnalysisBillingErrorResponse(error);
    if (billingError) return NextResponse.json(billingError, { status: 402 });
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed" }, { status: 500 });
  }
}
