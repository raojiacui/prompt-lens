import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory, operationLogs } from "@/lib/db";
import { analyzeFrames, ApiProvider } from "@/lib/ai/analyzer";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";

export async function POST(request: NextRequest) {
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
      frames: clientFrames,
      analyzeMode = "single",
      provider = "zhipu",
    } = body;

    if (!mediaUrl || !mediaType) {
      return NextResponse.json({ error: "Missing mediaUrl or mediaType" }, { status: 400 });
    }

    // 客户端直接传帧（浏览器提取）
    let frames: string[] = [];

    if (clientFrames && clientFrames.length > 0) {
      frames = clientFrames;
      console.log("Using client-provided frames:", frames.length);
    } else {
      // 生产环境必须有客户端的帧
      return NextResponse.json(
        { error: "Please refresh the page and try again" },
        { status: 400 }
      );
    }

    if (frames.length === 0) {
      return NextResponse.json({ error: "No frames available" }, { status: 400 });
    }

    // 记录分析开始
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.start",
      resourceType: mediaType,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider },
    });

    console.log("Calling AI analysis with", frames.length, "frames...");

    // 调用 AI 分析
    const result = await analyzeFrames({
      userId: session.user.id,
      provider: provider as ApiProvider,
      frames,
      mode: analyzeMode as "single" | "batch",
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

    // 保存到历史记录
    const historyRecord = await db.insert(analysisHistory).values({
      userId: session.user.id,
      mediaType,
      mediaUrl,
      mediaName: mediaUrl.split("/").pop(),
      frameCount: frames.length,
      analyzeMode,
      prompt: result.prompt!,
      corePrompt: result.corePrompt!,
    }).returning();

    // 记录完成
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: mediaType,
      resourceId: historyRecord[0].id,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider },
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
  }
}