import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireReferenceVideoUser } from "@/lib/reference-video/auth";
import { createKieVeoGeneration, getKieVeoGenerationStatus } from "@/lib/reference-video/kie-veo";
import { db, sceneVersions, videoGeneration, workflowJobs } from "@/lib/db";
import { getModelById, listModels, routeModel } from "@/lib/ai/model-registry";
import { resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";

export const runtime = "nodejs";

const MIN_VIDEO_DURATION = 4;

function durationRange(maxDuration: number) {
  const max = Math.max(1, Math.round(maxDuration));
  const min = Math.min(MIN_VIDEO_DURATION, max);
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

const VIDEO_MODELS = [...listModels("video_generation"), ...listModels("video_edit")].map((model) => ({
  id: model.kieModelId,
  category: model.category,
  supportedAspectRatios: model.aspectRatios || ["16:9"],
  supportedDurations: model.maxDuration ? durationRange(model.maxDuration) : model.category === "video_edit" ? [0] : durationRange(10),
}));

function isWanVideoEditModel(modelId: string) {
  return modelId === "wan/2-7-videoedit";
}

function parseModel(value: unknown, options: { hasReferenceVideo: boolean; hasImages: boolean }): string {
  if (typeof value === "string" && value.trim()) {
    const registryModel = getModelById(value.trim());
    if (registryModel?.kieModelId) return registryModel.kieModelId;
  }

  const routed = routeModel({
    category: "video_generation",
    priority: "balanced",
    requiredCapabilities: options.hasReferenceVideo
      ? ["text", "reference_video"]
      : options.hasImages
        ? ["text", "reference_image"]
        : ["text"],
  });
  return routed?.kieModelId || "veo3_fast";
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
  return supported.reduce((closest, candidate) => Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest, supported[0] ?? 5);
}

function optionalUuid(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalUrl(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : undefined;
}

function getReferenceVideoUrl(body: Record<string, unknown>) {
  const direct = optionalUrl(body.referenceVideoUrl);
  if (direct) return direct;
  const referenceVideo = body.referenceVideo;
  if (typeof referenceVideo === "object" && referenceVideo !== null) {
    return optionalUrl((referenceVideo as { url?: unknown }).url);
  }
  return undefined;
}

function getHiddenReferenceImageUrl(body: Record<string, unknown>, hasUserImages: boolean) {
  if (hasUserImages) return undefined;
  return optionalUrl(body.hiddenReferenceImageUrl);
}

function buildReferenceVideoPrompt(input: {
  prompt: string;
  hasReferenceVideo: boolean;
  hasImages: boolean;
  useNativeVideoEdit: boolean;
}) {
  if (input.useNativeVideoEdit) return input.prompt;

  const opening = input.hasReferenceVideo
    ? input.hasImages
      ? "Create a new video using the uploaded reference video for camera movement, shot rhythm, pacing, composition logic, and visual direction. Use the uploaded replacement images as the new visible subject or identity where relevant."
      : "Create a new video using the uploaded reference video for camera movement, shot rhythm, pacing, composition logic, and visual direction."
    : input.hasImages
      ? "Create an image-to-video generation from the uploaded image references and the user direction."
      : "Create a text-to-video generation from the user direction.";

  const closing = input.hasReferenceVideo
    ? input.hasImages
      ? "Final instruction: do not copy protected identity from the source video. Generate a fresh video that follows the reference motion and style, but uses the uploaded image references for replacement identity."
      : "Final instruction: do not copy protected identity from the source video. Generate a fresh video that follows the reference motion and style."
    : input.hasImages
      ? "Final instruction: preserve the uploaded image subject details, proportions, material, color, and recognizable identity."
      : "Final instruction: follow the prompt directly.";

  return [opening, input.prompt, closing].filter(Boolean).join("\n\n");
}

export async function POST(request: Request) {
  const auth = await requireReferenceVideoUser(request.headers);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const userPrompt = typeof body?.userPrompt === "string" && body.userPrompt.trim()
    ? body.userPrompt.trim()
    : typeof body?.prompt === "string"
      ? body.prompt.trim()
      : "";
  const referenceVideoUrl = body ? getReferenceVideoUrl(body) : undefined;
  if (!userPrompt && !referenceVideoUrl) return NextResponse.json({ error: "Missing generation prompt" }, { status: 400 });

  try {
    const replacementAssets = Array.isArray(body?.replacementAssets)
      ? body.replacementAssets.filter((item: unknown) => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { url?: unknown }).url === "string") as { id: string; url: string; type?: string; name?: string }[]
      : [];
    const userImageUrls = replacementAssets.map((asset) => asset.url).filter(Boolean);
    const hiddenReferenceImageUrl = getHiddenReferenceImageUrl(body || {}, userImageUrls.length > 0);
    const imageUrls = hiddenReferenceImageUrl ? [hiddenReferenceImageUrl] : userImageUrls;
    const hasReferenceVideo = Boolean(referenceVideoUrl);
    const hasImages = Boolean(imageUrls.length);
    const model = parseModel(body?.model, { hasReferenceVideo, hasImages });
    const useNativeVideoEdit = isWanVideoEditModel(model) && hasReferenceVideo;
    const aspectRatio = useNativeVideoEdit ? undefined : parseAspectRatio(body?.aspectRatio, model);
    const duration = useNativeVideoEdit ? 0 : parseDuration(body?.duration, model);
    const resolution = typeof body?.quality === "string" ? body.quality.toLowerCase() : undefined;
    const projectId = optionalUuid(body?.projectId);
    const sceneId = optionalUuid(body?.sceneId);
    const projectVersionId = optionalUuid(body?.projectVersionId || body?.versionId);
    const referenceImageUrl = useNativeVideoEdit ? imageUrls[0] : undefined;

    if (isWanVideoEditModel(model) && !referenceVideoUrl) {
      return NextResponse.json({ error: "Wan 2.7 Video Edit requires a reference video." }, { status: 400 });
    }

    const keyAccess = await resolveKieApiKeyForFeature(auth.user.id, { allowPaidPlatformKey: false });
    if (!keyAccess.apiKey) {
      return NextResponse.json({ error: "视频生成需要先在设置里配置你自己的 KIE API Key。平台不再提供视频生成额度。", code: "KIE_BYOK_REQUIRED" }, { status: 402 });
    }


    const prompt = buildReferenceVideoPrompt({
      prompt: userPrompt || "Follow the uploaded reference video.",
      hasReferenceVideo,
      hasImages,
      useNativeVideoEdit,
    });

    const result = await createKieVeoGeneration({
      prompt,
      imageUrls: useNativeVideoEdit ? [] : imageUrls,
      referenceVideoUrl,
      referenceImageUrl,
      aspectRatio,
      model,
      duration,
      resolution,
      generationType: imageUrls.length ? "REFERENCE_2_VIDEO" : "TEXT_2_VIDEO",
    }, keyAccess.apiKey);

    const [record] = await db.insert(videoGeneration).values({
      userId: auth.user.id,
      taskId: result.taskId,
      projectId,
      sceneId,
      projectVersionId,
      prompt,
      model,
      provider: "kie",
      status: "pending",
      duration,
      resolution,
      rawResponse: { ...(result.raw as Record<string, unknown>), billing: { keySource: keyAccess.source, chargedCredits: 0 } },
    }).returning();


    if (projectId) {
      await db.insert(workflowJobs).values({
        projectId,
        sceneId,
        type: "GENERATE_VIDEO",
        status: "processing",
        provider: "kie",
        modelId: model,
        externalTaskId: result.taskId,
        input: { generationId: record.id, projectVersionId, duration, aspectRatio, resolution, replacementAssetCount: userImageUrls.length, hiddenReferenceImage: Boolean(hiddenReferenceImageUrl), referenceVideoUrl, mode: hasReferenceVideo ? "reference_video_to_video" : hasImages ? "image_to_video" : "text_to_video" },
      });
    }

    return NextResponse.json({
      success: true,
      id: record.id,
      providerTaskId: result.taskId,
      status: "generating",
      provider: "kie.ai",
      billing: { keySource: keyAccess.source, chargedCredits: 0 },
    });
  } catch (error) {
    console.error("Generation job creation error:", error);
    const message = error instanceof Error ? error.message : "Generation request failed";
    const friendlyMessage = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|TLS/i.test(message)
      ? "视频生成服务连接 KIE 失败，请检查服务器网络、KIE 接口地址和你的 KIE API Key 配置。"
      : message;
    return NextResponse.json({ error: friendlyMessage }, { status: 502 });
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
      const job = await db.query.videoGeneration.findFirst({ where: and(eq(videoGeneration.id, jobId), eq(videoGeneration.userId, auth.user.id)) });
      if (!job) return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
      return NextResponse.json({ job });
    }

    if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

    const job = await db.query.videoGeneration.findFirst({ where: and(eq(videoGeneration.taskId, taskId), eq(videoGeneration.userId, auth.user.id)) });
    const keyAccess = await resolveKieApiKeyForFeature(auth.user.id, { allowPaidPlatformKey: false });
    if (!keyAccess.apiKey) return NextResponse.json({ error: "视频生成状态查询需要先在设置里配置你自己的 KIE API Key。", code: "KIE_BYOK_REQUIRED" }, { status: 402 });
    const status = await getKieVeoGenerationStatus(taskId, job?.model || undefined, keyAccess.apiKey);
    const normalizedStatus = status.state === "success" ? "completed" : status.state === "fail" ? "failed" : "processing";

    if (job) {
      await db.update(videoGeneration).set({ status: normalizedStatus, videoUrl: status.videoUrl, error: status.error, rawResponse: status.raw as Record<string, unknown>, updatedAt: new Date() }).where(eq(videoGeneration.id, job.id));

      const generationJob = await db.query.workflowJobs.findFirst({ where: eq(workflowJobs.externalTaskId, taskId) });
      if (generationJob) {
        await db.update(workflowJobs).set({
          status: normalizedStatus === "completed" ? "completed" : normalizedStatus === "failed" ? "failed" : "processing",
          resultUrl: status.videoUrl,
          error: status.error,
          output: { providerTaskId: status.taskId, videoUrl: status.videoUrl, raw: status.raw as Record<string, unknown> },
          completedAt: normalizedStatus === "completed" || normalizedStatus === "failed" ? new Date() : undefined,
          updatedAt: new Date(),
        }).where(eq(workflowJobs.id, generationJob.id));
      }

      if (normalizedStatus === "completed" && status.videoUrl && job.sceneId && job.projectVersionId) {
        await db.update(sceneVersions).set({ generatedVideoUrl: status.videoUrl, updatedAt: new Date() }).where(and(eq(sceneVersions.originalSceneId, job.sceneId), eq(sceneVersions.projectVersionId, job.projectVersionId)));
      }
    }

    return NextResponse.json({ provider: "kie.ai", providerTaskId: status.taskId, status: status.state, videoUrl: status.videoUrl, error: status.error, raw: status.raw });
  } catch (error) {
    console.error("Generation job status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status request failed" }, { status: 500 });
  }
}
