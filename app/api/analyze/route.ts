import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory, operationLogs } from "@/lib/db";
import { analyzeFrames, ApiProvider } from "@/lib/ai/analyzer";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { defaultLocale, isLocale } from "@/i18n/config";
import { assertTrialQuota, getUsableUserAnalyzeApiKeyProvider, trialQuotaResponse } from "@/lib/usage/trial-quota";
import { deleteFromR2, extractR2Key } from "@/lib/cloudflare/r2";
import { AnalysisFrameInputError, resolveAnalysisFrames } from "@/lib/ai/analysis-frame-input";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let temporaryFrameKeys: string[] = [];
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 速率限制检查
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
    const {
      mediaUrl,
      mediaType,
      frameUrls,
      frames: clientFrames,
      analyzeMode = "single",
      provider = "openrouter",
      outputLanguage,
    } = body;

    if (!mediaUrl || !mediaType) {
      return NextResponse.json({ error: "Missing mediaUrl or mediaType" }, { status: 400 });
    }

    // 校验 outputLanguage，未命中回落到默认
    const resolvedLanguage = isLocale(outputLanguage) ? outputLanguage : defaultLocale;

    let frames: string[];
    try {
      const resolved = resolveAnalysisFrames({
        userId: session.user.id,
        frameUrls,
        clientFrames,
        extractKey: extractR2Key,
      });
      frames = resolved.frames;
      temporaryFrameKeys = resolved.temporaryKeys;
    } catch (error) {
      if (error instanceof AnalysisFrameInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const requestedProvider = provider as ApiProvider;
    const userKeyProvider = await getUsableUserAnalyzeApiKeyProvider(session.user.id, requestedProvider);
    const effectiveProvider = userKeyProvider || requestedProvider;

    let quota: Awaited<ReturnType<typeof assertTrialQuota>>;
    try {
      quota = await assertTrialQuota(session.user.id, effectiveProvider);
    } catch (error) {
      const quotaError = trialQuotaResponse(error);
      if (quotaError) return NextResponse.json(quotaError, { status: 402 });
      throw error;
    }

    // 记录分析开始
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.start",
      resourceType: mediaType,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider: effectiveProvider, requestedProvider, apiKeySource: quota.apiKeySource },
    });

    console.log("Calling AI analysis with", frames.length, "frames...");

    // 调用 AI 分析（按当前 locale 选择 prompt 模板）
    const result = await analyzeFrames({
      userId: session.user.id,
      provider: effectiveProvider,
      frames,
      mode: analyzeMode as "single" | "batch",
      outputLanguage: resolvedLanguage,
    });

    if (!result.success) {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "analysis.error",
        resourceType: mediaType,
        metadata: { error: result.error, mediaUrl },
      });
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // 保存到历史记录（记录语言字段，便于后续按语言过滤/展示）
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

    // 记录完成
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: mediaType,
      resourceId: historyRecord[0].id,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider: effectiveProvider, requestedProvider, apiKeySource: quota.apiKeySource },
    });

    return NextResponse.json({
      success: true,
      prompt: result.prompt,
      corePrompt: result.corePrompt,
      historyId: historyRecord[0].id,
    });
  } catch (error: any) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 });
  } finally {
    if (temporaryFrameKeys.length > 0) {
      const cleanup = await Promise.allSettled(temporaryFrameKeys.map((key) => deleteFromR2(key)));
      const failed = cleanup.filter((result) => result.status === "rejected").length;
      if (failed > 0) console.warn(`Failed to clean up ${failed} temporary analysis frame(s)`);
    }
  }
}
