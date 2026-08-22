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
import { getModelById, routeModel, type ModelRegistryEntry } from "@/lib/ai/model-registry";

const VIDEO_GENERATE_LIMIT = { limit: 3, windowMs: 60000 };
const MIN_VIDEO_DURATION = 4;

function selectedGenerationModel(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const model = getModelById(value.trim());
    if (model?.category === "video_generation") return model;
  }
  return routeModel({ category: "video_generation", priority: "balanced", requiredCapabilities: ["text"] });
}

function parseAspectRatio(value: unknown, model: ModelRegistryEntry | null | undefined) {
  const supported = model?.aspectRatios?.length ? model.aspectRatios : ["16:9"];
  if (value === "auto") return undefined;
  if (typeof value === "string" && supported.includes(value)) return value;
  return supported[0];
}

function parseDuration(value: unknown, model: ModelRegistryEntry | null | undefined) {
  const max = Math.max(1, Math.round(model?.maxDuration || 10));
  const min = Math.min(MIN_VIDEO_DURATION, max);
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  const requested = Number.isFinite(parsed) ? Math.round(parsed) : Math.min(10, max);
  return Math.min(max, Math.max(min, requested));
}

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
    const selectedModel = selectedGenerationModel(body?.model || body?.modelId);
    const normalizedDuration = parseDuration(body?.duration, selectedModel);
    const aspectRatio = parseAspectRatio(body?.aspectRatio, selectedModel);
    const resolution = typeof body?.resolution === "string" ? body.resolution : undefined;
    const negativePrompt = typeof body?.negativePrompt === "string" ? body.negativePrompt : undefined;
    const model = selectedModel?.kieModelId || KIE_VIDEO_MODEL;

    // 获取用户配置的 provider API Key
    const userApiKey = await getUserProviderApiKey(session.user.id, provider as any);
    const effectiveApiKey = userApiKey;
    if (!effectiveApiKey) {
      return NextResponse.json({ error: "请先在设置中添加你自己的 KIE API Key" }, { status: 400 });
    }

    const videoProvider = createVideoProvider(provider as any, effectiveApiKey);
    const result = await videoProvider.createTask({
      prompt,
      duration: normalizedDuration,
      resolution,
      negativePrompt,
      model,
      aspectRatio,
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
