import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createVideoProvider,
  getUserProviderApiKey,
  DEFAULT_VIDEO_PROVIDER,
} from "@/lib/ai/video-generator";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { db, videoGeneration } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { videoGenerationInput } from "@/lib/ai/video-models";

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
    const parsed = videoGenerationInput.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid generation settings" }, { status: 400 });
    }
    const { prompt, provider, model, duration: normalizedDuration, resolution, negativePrompt } = parsed.data;

    // 获取用户配置的 provider API Key
    const userApiKey = await getUserProviderApiKey(session.user.id, provider as any);
    if (!userApiKey?.trim()) {
      return NextResponse.json({ error: "请先在设置中配置你自己的 KIE API Key，视频生成不使用平台额度", code: "PERSONAL_API_KEY_REQUIRED" }, { status: 403 });
    }

    const videoProvider = createVideoProvider(provider, userApiKey);
    const result = await videoProvider.createTask(parsed.data);

    const records = await db
      .insert(videoGeneration)
      .values({
        userId: session.user.id,
        taskId: result.taskId,
        prompt,
        negativePrompt,
        duration: normalizedDuration,
        resolution,
        model,
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

    if (request.nextUrl.searchParams.get("access") === "true") {
      const apiKey = await getUserProviderApiKey(session.user.id, DEFAULT_VIDEO_PROVIDER);
      return NextResponse.json({ hasOwnApiKey: Boolean(apiKey?.trim()) }, { headers: { "Cache-Control": "no-store" } });
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
