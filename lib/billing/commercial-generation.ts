import { and, eq, sql } from "drizzle-orm";
import { db, commercialTasks, commercialWallets, mediaCleanupJobs, projects, sceneVersions, videoGeneration } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { copyR2Object } from "@/lib/cloudflare/r2";
import { getModelById } from "@/lib/ai/model-registry";
import { resolveGenerationModel } from "@/lib/ai/generation-models";
import { buildMarketGenerationPayload } from "@/lib/ai/generation-payload";
import { buildKIEVeoPayload, isKIEVeoModel } from "@/lib/ai/adapters/kie-video";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import { estimateGeneration } from "./pricing-v6";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { getKieVeoGenerationStatus } from "@/lib/reference-video/kie-veo";
import { assertOwnedUploadedVideo, commercialMediaRequest, type MediaPreview } from "./commercial-media";

type GenerationSnapshot = { pricingVersion: string; keyFingerprint: string; durationSeconds?: number; resolution?: string; referenceVideoSeconds?: number; projectId?: string; sceneId?: string; projectVersionId?: string; payload: { model: string; input: { prompt: string; duration?: string | number; resolution?: string; [key: string]: unknown } } };
function referenceVideoUrl(body: Record<string, unknown>) {
  const reference = body.referenceVideo as { url?: unknown } | undefined;
  return typeof body.referenceVideoUrl === "string" ? body.referenceVideoUrl : typeof reference?.url === "string" ? reference.url : undefined;
}

export function buildCommercialGenerationPayload(body: Record<string, unknown>, probedReferenceSeconds?: number) {
  const prompt = String(body.userPrompt || body.prompt || "").trim();
  const images = Array.isArray(body.replacementAssets) ? body.replacementAssets.map((a) => String((a as { url?: unknown })?.url || "")) : [];
  if (!images.length && typeof body.hiddenReferenceImageUrl === "string" && body.hiddenReferenceImageUrl) images.push(body.hiddenReferenceImageUrl);
  const video = referenceVideoUrl(body);
  if (images.length > 9 || [...images, ...(video ? [video] : [])].some((url) => { try { const u = new URL(url); return u.protocol !== "https:" || Boolean(u.username || u.password); } catch { return true; } })) throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
  const requested = typeof body.model === "string" ? body.model : "";
  const registry = requested && requested !== "auto" ? getModelById(requested) : undefined;
  if (requested && requested !== "auto" && (!registry?.enabled || !["video_generation", "video_edit"].includes(registry.category))) throw new Error("PAID_MODEL_NOT_VERIFIED");
  const selected = registry?.kieModelId || (video ? "bytedance/seedance-2-fast" : images.length ? "wan/2-6-image-to-video" : "wan/2-6-text-to-video");
  const entry = resolveGenerationModel(selected, { hasImages: images.length > 0, hasVideo: Boolean(video) });
  const model = entry.kieModelId;
  const duration = Number(body.duration);
  const resolution = typeof body.quality === "string" ? body.quality.toLowerCase() : "720p";
  if (prompt.length < 3 || prompt.length > 5000 || !Number.isSafeInteger(duration)) throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
  const aspect = typeof body.aspectRatio === "string" && body.aspectRatio !== "auto" ? body.aspectRatio : undefined;
  if (aspect && !entry.aspectRatios?.includes(aspect)) throw new Error("PAID_GENERATION_ASPECT_UNSUPPORTED");
  if (video && (!Number.isSafeInteger(probedReferenceSeconds) || probedReferenceSeconds! <= 0)) throw new Error("REFERENCE_VIDEO_PROBE_REQUIRED");
  if (video && model.startsWith("bytedance/seedance-2") && (probedReferenceSeconds! < 2 || probedReferenceSeconds! > 15)) throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
  if (model === "wan/2-7-videoedit" && (probedReferenceSeconds! < 2 || probedReferenceSeconds! > 10 || (duration !== 0 && duration > probedReferenceSeconds!))) throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
  if (isKIEVeoModel(model)) {
    const veo = buildKIEVeoPayload({ modelId: model, prompt, duration, resolution, aspectRatio: aspect }, images);
    if (!entry.resolutionOptions?.includes(resolution)) throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
    return { model, input: { prompt, resolution, duration, aspect_ratio: aspect || "16:9", generation_type: veo.generationType, ...(images.length ? { image_urls: images } : {}) } };
  }
  return buildMarketGenerationPayload({ modelId: model, prompt, duration, resolution, aspectRatio: aspect, referenceVideoUrl: video, generateAudio: body.generateAudio === true }, images);
}

export async function quoteCommercialGeneration(userId: string, body: Record<string, unknown>) {
  const key = getPlatformKieApiKey();
  if (!key) throw new Error("KIE_KEY_REQUIRED");
  const video = referenceVideoUrl(body);
  let referenceVideoSeconds: number | undefined;
  let generationBody = body;
  if (video) {
    const sourceKey = await assertOwnedUploadedVideo(userId, video);
    const preparation = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-preview:${userId}`}))`);
      const wallet = await tx.query.commercialWallets.findFirst({ where: eq(commercialWallets.userId, userId) });
      if (!wallet || wallet.frozen || wallet.credits <= 0) throw new Error("INSUFFICIENT_COMMERCIAL_BALANCE");
      const recent = await tx.select({ id: commercialTasks.id }).from(commercialTasks).where(and(eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis_preview"), sql`${commercialTasks.createdAt} > now() - interval '1 hour'`)).limit(10);
      if (recent.length >= 10) throw new Error("PREVIEW_RATE_LIMIT");
      // Reuse the existing durable media-preview quota; this row is never confirmable.
      const [row] = await tx.insert(commercialTasks).values({ userId, kind: "analysis_preview", state: "running", input: { purpose: "generation", video }, expiresAt: new Date(Date.now() + 600000) }).returning();
      return row;
    });
    try {
      // Users retain upload permissions on the original; probe and bill a server-only snapshot.
      const suffix = sourceKey.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || ".mp4";
      const storageKey = `generation-input/${userId}/${randomUUID()}${suffix}`;
      await db.insert(mediaCleanupJobs).values({ storageKey, nextAttemptAt: new Date(Date.now() + 30 * 86400000) });
      const frozenVideo = await copyR2Object(sourceKey, storageKey);
      generationBody = { ...body, referenceVideoUrl: frozenVideo };
      const preview = await commercialMediaRequest<MediaPreview>(frozenVideo, { mode: "preview", automaticSplit: false });
      if (!Number.isSafeInteger(preview.durationUs) || preview.durationUs <= 0 || preview.durationUs > 60_000_000) throw new Error("INVALID_MEDIA_PROBE");
      referenceVideoSeconds = Math.ceil(preview.durationUs / 1_000_000);
      await db.update(commercialTasks).set({ state: "completed", result: { durationUs: preview.durationUs }, updatedAt: new Date() }).where(eq(commercialTasks.id, preparation.id));
    } catch (error) {
      await db.update(commercialTasks).set({ state: "failed", updatedAt: new Date() }).where(eq(commercialTasks.id, preparation.id));
      throw error;
    }
  }
  const payload = buildCommercialGenerationPayload(generationBody, referenceVideoSeconds);
  const durationSeconds = Number(payload.input.duration) || referenceVideoSeconds!;
  const resolution = String(body.quality || "720p").toLowerCase();
  const price = estimateGeneration({ modelId: payload.model, resolution, durationSeconds, referenceVideoSeconds, audio: body.generateAudio === true });
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
  const sceneId = typeof body.sceneId === "string" && body.sceneId ? body.sceneId : undefined;
  const projectVersionId = typeof (body.projectVersionId || body.versionId) === "string" ? String(body.projectVersionId || body.versionId) : undefined;
  if ((sceneId || projectVersionId) && !projectId) throw new Error("INVALID_PROJECT_CONTEXT");
  if (projectId) {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.userId, userId)) });
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (sceneId || projectVersionId) {
      if (!sceneId || !projectVersionId) throw new Error("INVALID_PROJECT_CONTEXT");
      const scene = await db.query.sceneVersions.findFirst({ where: and(eq(sceneVersions.projectId, projectId), eq(sceneVersions.originalSceneId, sceneId), eq(sceneVersions.projectVersionId, projectVersionId)) });
      if (!scene) throw new Error("SCENE_NOT_FOUND");
    }
  }
  const snapshot: GenerationSnapshot = { payload, durationSeconds, resolution, referenceVideoSeconds, keyFingerprint: generationKeyFingerprint(key), pricingVersion: price.version, projectId, sceneId, projectVersionId };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "generation", input: snapshot, credits: price.credits, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, credits: task.credits, expiresAt: task.expiresAt, model: payload.model, duration: durationSeconds, resolution, referenceVideoSeconds };
}

export async function executeCommercialGeneration(task: typeof commercialTasks.$inferSelect) {
  const input = task.input as GenerationSnapshot;
  const key = getPlatformKieApiKey();
  if (!key || generationKeyFingerprint(key) !== input.keyFingerprint) { await settleGeneration(task, "failed"); return; }
  const base = (process.env.KIE_AI_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
  const veo = isKIEVeoModel(input.payload.model);
  const payload = veo ? buildKIEVeoPayload({
    modelId: input.payload.model, prompt: input.payload.input.prompt,
    duration: Number(input.payload.input.duration), resolution: input.payload.input.resolution,
    aspectRatio: String(input.payload.input.aspect_ratio || "16:9"),
  }, input.payload.input.image_urls as string[] | undefined) : input.payload;
  const response = await fetch(`${base}${veo ? "/api/v1/veo/generate" : "/api/v1/jobs/createTask"}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  // Explicit rejection is terminal; transport errors and malformed acceptance remain under review.
  if ([400, 401, 402, 403, 422, 429, 433].includes(Number(data.code))) { await settleGeneration(task, "failed"); return; }
  if (!response.ok || data.code !== 200 || typeof data.data?.taskId !== "string") throw new Error("GENERATION_SUBMISSION_UNKNOWN");
  await db.transaction(async (tx) => {
    await tx.update(commercialTasks).set({ providerTaskId: data.data.taskId, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    await tx.insert(videoGeneration).values({ userId: task.userId, taskId: data.data.taskId, projectId: input.projectId, sceneId: input.sceneId, projectVersionId: input.projectVersionId, prompt: input.payload.input.prompt, model: input.payload.model, provider: "kie", status: "pending", duration: input.durationSeconds ?? Number(input.payload.input.duration), resolution: input.resolution ?? input.payload.input.resolution, rawResponse: { billing: { commercialTaskId: task.id, keySource: "platform_paid", keyFingerprint: input.keyFingerprint, reservedCredits: task.credits } } });
  });
}

export async function reconcileCommercialGeneration(taskId: string) {
  const [task] = await db.update(commercialTasks).set({ result: sql`${commercialTasks.result} || ${JSON.stringify({ queryAfter: Date.now() + 15000 })}::jsonb` }).where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.kind, "generation"), eq(commercialTasks.state, "running"), sql`COALESCE((${commercialTasks.result}->>'queryAfter')::bigint, 0) < ${Date.now()}`)).returning();
  if (!task?.providerTaskId) return;
  const input = task.input as GenerationSnapshot;
  const key = getPlatformKieApiKey();
  if (!key || generationKeyFingerprint(key) !== input.keyFingerprint) return;
  const status = await getKieVeoGenerationStatus(task.providerTaskId, input.payload.model, key);
  if (status.taskId !== task.providerTaskId) return;
  if (status.state === "success") {
    try { if (new URL(status.videoUrl || "").protocol !== "https:") return; } catch { return; }
  }
  if (status.state === "success" && status.videoUrl) await settleGeneration(task, "completed", status.videoUrl);
  else if (status.state === "fail") await settleGeneration(task, "failed");
}

async function settleGeneration(task: typeof commercialTasks.$inferSelect, state: "completed" | "failed", videoUrl?: string) {
  const input = task.input as GenerationSnapshot;
  const credits = state === "completed" ? task.credits : 0;
  await db.transaction(async (tx) => {
    await tx.select().from(commercialTasks).where(eq(commercialTasks.id, task.id)).for("update");
    await settleCommercialTaskInTransaction(tx, { userId: task.userId, taskKey: `commercial:${task.id}`, credits, rewrites: 0 });
    await tx.update(commercialTasks).set({ state, result: sql`${commercialTasks.result} || ${JSON.stringify({ videoUrl, chargedCredits: credits })}::jsonb`, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    if (task.providerTaskId) await tx.update(videoGeneration).set({ status: state, videoUrl, updatedAt: new Date() }).where(and(eq(videoGeneration.taskId, task.providerTaskId), eq(videoGeneration.userId, task.userId)));
    if (state === "completed" && videoUrl && input.projectId && input.sceneId && input.projectVersionId) await tx.update(sceneVersions).set({ generatedVideoUrl: videoUrl, updatedAt: new Date() }).where(and(eq(sceneVersions.projectId, input.projectId), eq(sceneVersions.originalSceneId, input.sceneId), eq(sceneVersions.projectVersionId, input.projectVersionId)));
  });
}
