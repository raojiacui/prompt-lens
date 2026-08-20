import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, audioAnalysis, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { transcribeMediaWithKie, type TranscriptSegment } from "@/lib/workflow/transcription";

function buildSegments(transcription: TranscriptSegment[], duration: number) {
  if (!transcription.length) return [];
  const segmentDuration = 30;
  const maxDuration = duration || transcription[transcription.length - 1]?.end || 0;
  const segments: Array<{ start: number; end: number; summary: string; tags: string[] }> = [];
  let currentStart = 0;
  while (currentStart < maxDuration) {
    const currentEnd = Math.min(currentStart + segmentDuration, maxDuration);
    const words = transcription.filter((item) => item.end > currentStart && item.start < currentEnd);
    if (words.length) {
      segments.push({
        start: currentStart,
        end: currentEnd,
        summary: words.map((item) => item.text).join(" ").slice(0, 180),
        tags: ["kie", "transcript"],
      });
    }
    currentStart = currentEnd;
  }
  return segments;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { allowed, resetIn } = checkRateLimit(
      session.user.id,
      RateLimitConfigs.analyze.limit,
      RateLimitConfigs.analyze.windowMs,
    );
    if (!allowed) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
    if (!mediaUrl) return NextResponse.json({ error: "Missing mediaUrl" }, { status: 400 });

    const apiKey = await getUserKieApiKey(session.user.id) || process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || null;
    if (!apiKey) return NextResponse.json({ error: "Please add your KIE API Key in Settings before audio analysis." }, { status: 400 });

    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.start",
      resourceType: "audio",
      metadata: { mediaUrl, provider: "kie" },
    }).catch(() => undefined);

    const result = await transcribeMediaWithKie({
      userId: session.user.id,
      apiKey,
      mediaUrl,
      modelMode: body?.modelMode === "manual" ? "manual" : "auto",
      modelId: typeof body?.modelId === "string" ? body.modelId : undefined,
      modelPriority: body?.modelPriority || "balanced",
    });
    if (!result) return NextResponse.json({ error: "KIE transcription is not available." }, { status: 502 });

    const duration = Math.round(result.segments.reduce((max, item) => Math.max(max, item.end), 0));
    const segments = buildSegments(result.segments, duration);
    const mediaName = mediaUrl.split("/").pop() || "unknown";
    const [record] = await db.insert(audioAnalysis).values({
      userId: session.user.id,
      mediaUrl,
      mediaName,
      language: "auto",
      transcription: result.segments,
      segments,
      duration,
      whisperModel: result.modelId,
      prompt: typeof body?.prompt === "string" ? body.prompt : null,
      status: "completed",
    }).returning();

    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: "audio",
      resourceId: record.id,
      metadata: { mediaUrl, provider: "kie", modelId: result.modelId, taskId: result.taskId, segmentCount: segments.length, duration },
    }).catch(() => undefined);

    return NextResponse.json({
      success: true,
      id: record.id,
      provider: "kie",
      modelId: result.modelId,
      providerTaskId: result.taskId,
      language: "auto",
      transcription: result.segments,
      segments,
      duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const records = await db.query.audioAnalysis.findMany({
      where: (table, { eq }) => eq(table.userId, session.user.id),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit,
      offset,
    });

    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch audio analysis history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
