import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createVideoProvider,
  getUserProviderApiKey,
  KIE_VIDEO_MODEL,
  DEFAULT_VIDEO_PROVIDER,
} from "@/lib/ai/video-generator";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { db, videoGeneration } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";

const VIDEO_GENERATE_LIMIT = { limit: 3, windowMs: 60000 };

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, resetIn } = checkRateLimit(
      `video-generate:${session.user.id}`,
      VIDEO_GENERATE_LIMIT.limit,
      VIDEO_GENERATE_LIMIT.windowMs
    );

    if (!allowed) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const provider = (body?.provider as string) || DEFAULT_VIDEO_PROVIDER;
    const duration = Number(body?.duration);
    const normalizedDuration = Number.isFinite(duration) ? duration : undefined;
    const resolution = typeof body?.resolution === "string" ? body.resolution : undefined;
    const negativePrompt = typeof body?.negativePrompt === "string" ? body.negativePrompt : undefined;

    // 获取用户配置的 provider API Key
    const userApiKey = await getUserProviderApiKey(session.user.id, provider as any);
    const effectiveApiKey = userApiKey || process.env.KIE_API_KEY;
    if (!effectiveApiKey) {
      return NextResponse.json({ error: "未配置 API Key，请先在设置中添加" }, { status: 400 });
    }

    const videoProvider = createVideoProvider(provider as any, effectiveApiKey);
    const result = await videoProvider.createTask({
      prompt,
      duration: normalizedDuration,
      resolution,
      negativePrompt,
    });

    const records = await db
      .insert(videoGeneration)
      .values({
        userId: session.user.id,
        taskId: result.taskId,
        prompt,
        negativePrompt,
        duration: normalizedDuration,
        resolution,
        model: KIE_VIDEO_MODEL,
        provider,
        status: "pending",
        rawResponse: result.raw as any,
      })
      .returning();

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      record: records[0],
      provider,
    });
  } catch (error: any) {
    console.error("[video-generate] Error:", error);
    const status = error?.message?.includes("KIE_API_KEY") ? 500 : 502;
    return NextResponse.json(
      { error: error?.message || "Video generation task creation failed" },
      { status }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const taskId = request.nextUrl.searchParams.get("taskId");
    if (taskId) {
      const record = await db.query.videoGeneration.findFirst({
        where: and(
          eq(videoGeneration.userId, session.user.id),
          eq(videoGeneration.taskId, taskId)
        ),
      });

      if (!record) {
        return NextResponse.json({ error: "Record not found" }, { status: 404 });
      }

      return NextResponse.json({ record });
    }

    const records = await db.query.videoGeneration.findMany({
      where: eq(videoGeneration.userId, session.user.id),
      orderBy: [desc(videoGeneration.createdAt)],
      limit: 20,
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error("[video-generate/list] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
