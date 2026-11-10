import { isUserProvider } from "@/lib/ai/providers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createVideoProvider } from "@/lib/ai/video-provider";
import { resolveGenerationStatusKey } from "@/lib/billing/generation-key";
import { db, videoGeneration } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { kieErrorResponse } from "@/lib/reference-video/kie-veo";

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
    if (!isUserProvider(provider)) {
      return NextResponse.json({ status: "failed", error: "Unsupported video provider" }, { status: 400 });
    }

    const apiKey = await resolveGenerationStatusKey(session.user.id, record.rawResponse, provider);
    if (!apiKey) {
      return NextResponse.json({ error: "视频生成状态查询需要先在设置里配置此任务原供应商的 API Key。", code: "KIE_BYOK_REQUIRED" }, { status: 402 });
    }

    const videoProvider = createVideoProvider(provider, apiKey);
    const status = await videoProvider.getStatus(taskId, record.model);
    const progress = status.progress === undefined ? undefined : String(status.progress);

    const records = await db
      .update(videoGeneration)
      .set({
        status: status.status,
        progress,
        videoUrl: status.videoUrl,
        error: status.error,
        rawResponse: { ...(status.raw as Record<string, unknown>), billing: (record.rawResponse as Record<string, unknown> | null)?.billing },
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
    const kieError = kieErrorResponse(error);
    if (kieError) return NextResponse.json({ ...kieError.body, status: "unknown" }, { status: kieError.status });
    const message = error instanceof Error ? error.message : "Video generation status query failed";
    const status = message.includes("KIE_API_KEY") ? 500 : 502;
    return NextResponse.json(
      { status: "unknown", error: message },
      { status }
    );
  }
}

