import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createVideoProvider } from "@/lib/ai/video-generator";
import { resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";
import { db, videoGeneration } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const taskId = request.nextUrl.searchParams.get("taskId");
    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    const record = await db.query.videoGeneration.findFirst({
      where: and(
        eq(videoGeneration.userId, session.user.id),
        eq(videoGeneration.taskId, taskId)
      ),
    });

    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const provider = record.provider || "kie";
    if (provider !== "kie") {
      return NextResponse.json({ status: "failed", error: "当前视频生成仅支持 KIE 模型" }, { status: 400 });
    }

    const keyAccess = await resolveKieApiKeyForFeature(session.user.id, { allowPaidPlatformKey: false });
    if (!keyAccess.apiKey) {
      return NextResponse.json({ error: "视频生成状态查询需要先在设置里配置你自己的 KIE API Key。", code: "KIE_BYOK_REQUIRED" }, { status: 402 });
    }

    const videoProvider = createVideoProvider(provider, keyAccess.apiKey);
    const status = await videoProvider.getStatus(taskId, record.model);
    const progress = status.progress === undefined ? undefined : String(status.progress);

    const records = await db
      .update(videoGeneration)
      .set({
        status: status.status,
        progress,
        videoUrl: status.videoUrl,
        error: status.error,
        rawResponse: status.raw as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(and(
        eq(videoGeneration.userId, session.user.id),
        eq(videoGeneration.taskId, taskId)
      ))
      .returning();

    return NextResponse.json({
      ...status,
      record: records[0],
    });
  } catch (error: unknown) {
    console.error("[video-generate/status] Error:", error);
    const message = error instanceof Error ? error.message : "Video generation status query failed";
    const status = message.includes("KIE_API_KEY") ? 500 : 502;
    return NextResponse.json(
      { status: "failed", error: message },
      { status }
    );
  }
}

