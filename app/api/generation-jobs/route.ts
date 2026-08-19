import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireReferenceVideoUser } from "@/lib/reference-video/auth";
import {
  createKieVeoGeneration,
  getKieVeoGenerationStatus,
} from "@/lib/reference-video/kie-veo";
import { db, videoGeneration } from "@/lib/db";
import { getModelById, listModels, routeModel } from "@/lib/ai/model-registry";
import { getUserKieApiKey } from "@/lib/byok/kie";

export const runtime = "nodejs";

const VIDEO_MODELS = [...listModels("video_generation"), ...listModels("video_edit")].map((model) => ({
  id: model.kieModelId,
  supportedAspectRatios: model.aspectRatios || ["16:9"],
  supportedDurations: model.maxDuration ? [model.maxDuration] : [5],
}));

function parseModel(value: unknown): string {
  const routed = routeModel({ category: "video_generation", priority: "balanced" });
  const fallback = routed?.kieModelId || "veo3_fast";
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const registryModel = getModelById(raw);
  return registryModel?.kieModelId || fallback;
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

    const apiKey = await getUserKieApiKey(auth.user.id);
    if (!apiKey && !process.env.KIE_AI_API_KEY && !process.env.KIE_API_KEY) {
      return NextResponse.json({ error: "Please add your KIE API Key in Settings before generating video." }, { status: 400 });
    }

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

    const apiKey = await getUserKieApiKey(auth.user.id);
    const status = await getKieVeoGenerationStatus(taskId, job?.model || undefined, apiKey || undefined);
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
