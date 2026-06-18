import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createVideoProvider, getUserProviderApiKey } from "@/lib/ai/video-generator";
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
    const userApiKey = await getUserProviderApiKey(session.user.id, provider as any);
    const effectiveApiKey = userApiKey || process.env.KIE_API_KEY;
    if (!effectiveApiKey) {
      return NextResponse.json({ error: "未配置 API Key" }, { status: 400 });
    }

    const videoProvider = createVideoProvider(provider as any, effectiveApiKey);
    const status = await videoProvider.getStatus(taskId);
    const progress = status.progress === undefined ? undefined : String(status.progress);

    const records = await db
      .update(videoGeneration)
      .set({
        status: status.status,
        progress,
        videoUrl: status.videoUrl,
        error: status.error,
        rawResponse: status.raw as any,
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
  } catch (error: any) {
    console.error("[video-generate/status] Error:", error);
    const status = error?.message?.includes("KIE_API_KEY") ? 500 : 502;
    return NextResponse.json(
      { status: "failed", error: error?.message || "Video generation status query failed" },
      { status }
    );
  }
}
