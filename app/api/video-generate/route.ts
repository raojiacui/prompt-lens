import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createVideoProvider,
  DEFAULT_KIE_VIDEO_MODEL,
  DEFAULT_VIDEO_PROVIDER,
} from "@/lib/ai/video-provider";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { db, videoGeneration } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { getModelById, routeModel, type ModelRegistryEntry } from "@/lib/ai/model-registry";
import { resolveApiKeyForFeature } from "@/lib/billing/platform-access";
import { generationKeyFingerprint } from "@/lib/billing/generation-key";
import { kieErrorResponse } from "@/lib/reference-video/kie-veo";

const VIDEO_GENERATE_LIMIT = { limit: 3, windowMs: 60000 };
const MIN_VIDEO_DURATION = 4;

function selectedGenerationModel(value: unknown, provider: "kie" | "infistar") {
  if (typeof value === "string" && value.trim()) {
    const model = getModelById(value.trim());
    if (model?.category === "video_generation" && model.provider === provider) return model;
  }
  return routeModel({ category: "video_generation", provider, priority: "balanced", requiredCapabilities: ["text"] });
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

    const { allowed, resetIn } = await checkRateLimit(
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
    const commercialEnabled = process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true";
    if (commercialEnabled && body?.payer !== "byok") {
      return NextResponse.json({ error: "Confirm a commercial quote before generation", code: "COMMERCIAL_QUOTE_REQUIRED" }, { status: 409 });
    }
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const keyAccess = await resolveApiKeyForFeature(session.user.id, { allowPaidPlatformKey: false });
    const provider = keyAccess.provider || DEFAULT_VIDEO_PROVIDER;

    const selectedModel = selectedGenerationModel(body?.model || body?.modelId, provider);
    const normalizedDuration = parseDuration(body?.duration, selectedModel);
    const aspectRatio = parseAspectRatio(body?.aspectRatio, selectedModel);
    const resolution = typeof body?.resolution === "string" ? body.resolution : undefined;
    const negativePrompt = typeof body?.negativePrompt === "string" ? body.negativePrompt : undefined;
    const model = selectedModel?.providerModelId || (provider === "infistar" ? "doubao-seedance-2.0-mini" : DEFAULT_KIE_VIDEO_MODEL);

    if (!keyAccess.apiKey || (commercialEnabled && keyAccess.source !== "user")) {
      return NextResponse.json({ error: "视频生成需要先在设置里配置你自己的 Infistar 或 KIE API Key。平台不再提供视频生成额度。", code: "KIE_BYOK_REQUIRED" }, { status: 402 });
    }


    if (selectedModel && selectedModel.provider !== provider) return NextResponse.json({ error: "请选择当前供应商支持的模型。" }, { status: 400 });
    const videoProvider = createVideoProvider(provider, keyAccess.apiKey);
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
        rawResponse: { ...(result.raw as Record<string, unknown>), billing: { provider, keySource: keyAccess.source, keyFingerprint: generationKeyFingerprint(keyAccess.apiKey), chargedCredits: 0 } },
      })
      .returning();


    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      record: records[0],
      provider,
      billing: { provider, keySource: keyAccess.source, keyFingerprint: generationKeyFingerprint(keyAccess.apiKey), chargedCredits: 0 },
    });
  } catch (error: unknown) {
    console.error("[video-generate] Error:", error);
    const kieError = kieErrorResponse(error);
    if (kieError) return NextResponse.json(kieError.body, { status: kieError.status });
    const message = error instanceof Error ? error.message : "Video generation task creation failed";
    const status = message.includes("KIE_API_KEY") ? 500 : 502;
    return NextResponse.json(
      { error: message },
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

