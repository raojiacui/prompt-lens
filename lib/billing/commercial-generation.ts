import { and, eq, sql } from "drizzle-orm";
import { db, commercialTasks, projects, sceneVersions, videoGeneration } from "@/lib/db";
import { getModelById } from "@/lib/ai/model-registry";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import { estimateGeneration } from "./pricing-v6";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { getKieVeoGenerationStatus } from "@/lib/reference-video/kie-veo";

type GenerationSnapshot = { pricingVersion: string; keyFingerprint: string; projectId?: string; sceneId?: string; projectVersionId?: string; payload: { model: string; input: { prompt: string; duration: string; resolution: string; image_urls?: string[]; multi_shots: boolean } } };
export function buildCommercialGenerationPayload(body: Record<string, unknown>) {
  const prompt = String(body.userPrompt || body.prompt || "").trim();
  const images = Array.isArray(body.replacementAssets) ? body.replacementAssets.map((a) => String((a as { url?: unknown })?.url || "")) : [];
  if (!images.length && typeof body.hiddenReferenceImageUrl === "string" && body.hiddenReferenceImageUrl) images.push(body.hiddenReferenceImageUrl);
  const reference = body.referenceVideo as { url?: string } | undefined;
  if (body.referenceVideoUrl || reference?.url || images.length > 1 || images.some((url) => !url.startsWith("https://"))) throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
  const requested = typeof body.model === "string" ? body.model : "";
  const model = requested && requested !== "auto" ? getModelById(requested)?.kieModelId || requested : images.length ? "wan/2-6-image-to-video" : "wan/2-6-text-to-video";
  if (model !== (images.length ? "wan/2-6-image-to-video" : "wan/2-6-text-to-video")) throw new Error("PAID_MODEL_NOT_VERIFIED");
  const duration = Number(body.duration);
  const resolution = typeof body.quality === "string" ? body.quality.toLowerCase() : "720p";
  if (prompt.length < 2 || prompt.length > 5000 || ![5, 10].includes(duration) || resolution !== "720p") throw new Error("PAID_GENERATION_CONFIGURATION_UNSUPPORTED");
  // Wan derives I2V framing from its source image. Do not promise an unsupported aspect-ratio override.
  if (body.aspectRatio && body.aspectRatio !== "auto" && body.aspectRatio !== "16:9") throw new Error("PAID_GENERATION_ASPECT_UNSUPPORTED");
  return { model, input: { prompt, duration: String(duration), resolution, multi_shots: false, ...(images.length ? { image_urls: images } : {}) } };
}

export async function quoteCommercialGeneration(userId: string, body: Record<string, unknown>) {
  const payload = buildCommercialGenerationPayload(body);
  const price = estimateGeneration({ modelId: payload.model, resolution: payload.input.resolution, durationSeconds: Number(payload.input.duration), audio: false });
  const key = getPlatformKieApiKey();
  if (!key) throw new Error("KIE_KEY_REQUIRED");
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
  const snapshot: GenerationSnapshot = { payload, keyFingerprint: generationKeyFingerprint(key), pricingVersion: price.version, projectId, sceneId, projectVersionId };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "generation", input: snapshot, credits: price.credits, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, credits: task.credits, expiresAt: task.expiresAt, model: payload.model, duration: Number(payload.input.duration), resolution: payload.input.resolution };
}

export async function executeCommercialGeneration(task: typeof commercialTasks.$inferSelect) {
  const input = task.input as GenerationSnapshot;
  const key = getPlatformKieApiKey();
  if (!key || generationKeyFingerprint(key) !== input.keyFingerprint) { await settleGeneration(task, "failed"); return; }
  const base = (process.env.KIE_AI_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
  const response = await fetch(`${base}/api/v1/jobs/createTask`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(input.payload), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  // Explicit rejection is terminal; transport errors and malformed acceptance remain under review.
  if ([400, 401, 402, 403, 422, 429, 433].includes(Number(data.code))) { await settleGeneration(task, "failed"); return; }
  if (!response.ok || data.code !== 200 || typeof data.data?.taskId !== "string") throw new Error("GENERATION_SUBMISSION_UNKNOWN");
  await db.transaction(async (tx) => {
    await tx.update(commercialTasks).set({ providerTaskId: data.data.taskId, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    await tx.insert(videoGeneration).values({ userId: task.userId, taskId: data.data.taskId, projectId: input.projectId, sceneId: input.sceneId, projectVersionId: input.projectVersionId, prompt: input.payload.input.prompt, model: input.payload.model, provider: "kie", status: "pending", duration: Number(input.payload.input.duration), resolution: input.payload.input.resolution, rawResponse: { billing: { commercialTaskId: task.id, keySource: "platform_paid", keyFingerprint: input.keyFingerprint, reservedCredits: task.credits } } });
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
