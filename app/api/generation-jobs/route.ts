import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireReferenceVideoUser } from "@/lib/reference-video/auth";
import {
  createKieVeoGeneration,
  getKieVeoGenerationStatus,
} from "@/lib/reference-video/kie-veo";
import { db, videoGeneration } from "@/lib/db";

export const runtime = "nodejs";

const VIDEO_MODELS = [
  { id: "wan/2-7-videoedit", supportedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"], supportedDurations: [0] },
  { id: "bytedance/seedance-2", supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"], supportedDurations: [5, 10] },
  { id: "bytedance/seedance-2-fast", supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"], supportedDurations: [5, 10] },
  { id: "veo3_fast", supportedAspectRatios: ["16:9", "9:16"], supportedDurations: [8] },
  { id: "grok-imagine/text-to-video", supportedAspectRatios: ["2:3", "3:2", "1:1", "16:9", "9:16"], supportedDurations: [6, 10] },
  { id: "bytedance/seedance-2-mini", supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"], supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  { id: "grok-imagine-video-1-5-preview", supportedAspectRatios: ["16:9", "9:16"], supportedDurations: [8] },
  { id: "kling-2.6/text-to-video", supportedAspectRatios: ["16:9", "9:16", "1:1"], supportedDurations: [5, 10] },
  { id: "kling-3.0/video", supportedAspectRatios: ["16:9", "9:16", "1:1"], supportedDurations: [3, 5, 10, 15] },
];

function parseModel(value: unknown): string {
  const fallback = "veo3_fast";
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const supported = VIDEO_MODELS.some((model) => model.id === raw);
  return supported ? raw : fallback;
}

function parseAspectRatio(value: unknown, modelId: string): string | undefined {
  const model = VIDEO_MODELS.find((m) => m.id === modelId);
  const supported = model?.supportedAspectRatios || ["16:9"];
  if (value === "auto") return undefined;
  if (typeof value !== "string") return supported[0];
  return supported.includes(value) ? value : supported[0];
}

function parseDuration(value: unknown, modelId: string): number {
  const model = VIDEO_MODELS.find((m) => m.id === modelId);
  const supported = model?.supportedDurations || [5];
  let parsed: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) parsed = value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) parsed = n;
  }
  const requested = Math.round(parsed ?? supported[0] ?? 5);
  return supported.reduce(
    (closest, candidate) =>
      Math.abs(candidate - requested) < Math.abs(closest - requested)
        ? candidate
        : closest,
    supported[0] ?? 5,
  );
}

export async function POST(request: Request) {
  const auth = await requireReferenceVideoUser(request.headers);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body?.prompt) {
    return NextResponse.json(
      { error: "Missing generation prompt" },
      { status: 400 },
    );
  }

  try {
    const model = parseModel(body.model);
    const aspectRatio = parseAspectRatio(body.aspectRatio, model);
    const duration = parseDuration(body.duration, model);
    const resolution = typeof body.quality === "string" ? body.quality.toLowerCase() : undefined;

    const replacementAssets = Array.isArray(body.replacementAssets)
      ? body.replacementAssets.filter(
          (item: unknown) =>
            typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { url?: unknown }).url === "string",
        ) as { id: string; url: string; type?: string; name?: string }[]
      : [];

    const imageUrls = replacementAssets.map((asset) => asset.url).filter(Boolean);

    const result = await createKieVeoGeneration({
      prompt: body.prompt,
      imageUrls,
      aspectRatio,
      model,
      duration,
      resolution,
      generationType: imageUrls.length ? "REFERENCE_2_VIDEO" : "TEXT_2_VIDEO",
    });

    const [record] = await db
      .insert(videoGeneration)
      .values({
        userId: auth.user.id,
        taskId: result.taskId,
        prompt: body.prompt,
        model,
        provider: "kie",
        status: "pending",
        duration,
        resolution,
        rawResponse: result.raw as Record<string, unknown>,
      })
      .returning();

    return NextResponse.json({
      success: true,
      id: record.id,
      providerTaskId: result.taskId,
      status: "generating",
      provider: "kie.ai",
    });
  } catch (error) {
    console.error("Generation job creation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Generation request failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const auth = await requireReferenceVideoUser(request.headers);
  if (auth.response) return auth.response;

  const searchParams = new URL(request.url).searchParams;
  const taskId = searchParams.get("taskId");
  const jobId = searchParams.get("jobId");

  try {
    if (jobId) {
      const job = await db.query.videoGeneration.findFirst({
        where: and(
          eq(videoGeneration.id, jobId),
          eq(videoGeneration.userId, auth.user.id),
        ),
      });
      if (!job) {
        return NextResponse.json(
          { error: "Generation job not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ job });
    }

    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    const job = await db.query.videoGeneration.findFirst({
      where: and(
        eq(videoGeneration.taskId, taskId),
        eq(videoGeneration.userId, auth.user.id),
      ),
    });

    const status = await getKieVeoGenerationStatus(taskId, job?.model || undefined);
    const normalizedStatus =
      status.state === "success"
        ? "completed"
        : status.state === "fail"
          ? "failed"
          : "processing";

    if (job) {
      await db
        .update(videoGeneration)
        .set({
          status: normalizedStatus,
          videoUrl: status.videoUrl,
          error: status.error,
          rawResponse: status.raw as Record<string, unknown>,
        })
        .where(eq(videoGeneration.id, job.id));
    }

    return NextResponse.json({
      provider: "kie.ai",
      providerTaskId: status.taskId,
      status: status.state,
      videoUrl: status.videoUrl,
      error: status.error,
      raw: status.raw,
    });
  } catch (error) {
    console.error("Generation job status error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Status request failed",
      },
      { status: 500 },
    );
  }
}
