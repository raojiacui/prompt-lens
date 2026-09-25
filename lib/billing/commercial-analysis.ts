import { and, eq, sql } from "drizzle-orm";
import { db, commercialTasks, projects, referenceVideos, projectVersions, videoScenes, sceneVersions } from "@/lib/db";
import { assertOwnedUploadedVideo, commercialMediaRequest, type MediaPreview } from "./commercial-media";
import { quoteAnalysis, settleAnalysis, type AnalysisPriceInput, PRICING_VERSION } from "./pricing-v6";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { getProjectBundle, retrySceneAnalysis } from "@/lib/workflow/service";
import { analyzeSceneBlueprint, buildFallbackSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";

export function commercialConsumptionEnabled() { return process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true"; }
type AnalysisInput = { projectId: string; mediaUrl: string; mediaName: string; preview: MediaPreview; pricing: AnalysisPriceInput; outputLanguage: "zh" | "en"; keyFingerprint: string; pricingVersion: string; retry?: { parentId: string; previousSuccess: string[]; previousCharged: number; sceneVersions: { id: string; sceneVersionId: string }[] } };

export async function prepareCommercialAnalysis(userId: string, input: { projectId: string; mediaUrl: string; mediaName: string; automaticSplit: boolean }) {
  if (!commercialConsumptionEnabled()) throw new Error("COMMERCIAL_NOT_ENABLED");
  await assertOwnedUploadedVideo(userId, input.mediaUrl);
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.userId, userId)) });
  if (!project || project.status !== "draft") throw new Error("PROJECT_NOT_READY");
  // A durable per-user quota applies before probing, across application instances.
  const preparation = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-preview:${userId}`}))`);
    const recent = await tx.select({ id: commercialTasks.id }).from(commercialTasks).where(and(eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis_preview"), sql`${commercialTasks.createdAt} > now() - interval '1 hour'`)).limit(10);
    if (recent.length >= 10) throw new Error("PREVIEW_RATE_LIMIT");
    const [row] = await tx.insert(commercialTasks).values({ userId, kind: "analysis_preview", state: "running", input, expiresAt: new Date(Date.now() + 900000) }).returning();
    return row;
  });
  const preview = await commercialMediaRequest<MediaPreview>(input.mediaUrl, { mode: "preview", automaticSplit: input.automaticSplit });
  // Validate worker quantities using the exact same billing validator before storing them.
  quoteAnalysis({ payer: input.automaticSplit ? "byok_split" : "byok", model: "flash", sourceDurationUs: preview.durationUs, automaticSplit: input.automaticSplit, paidSplitReusable: false, scenes: preview.scenes });
  if (!/^[0-9a-f]{64}$/.test(preview.sourceHash) || preview.bytes > 100 * 1024 * 1024) throw new Error("INVALID_MEDIA_PROBE");
  const [task] = await db.update(commercialTasks).set({ state: "quoted", input: { ...input, preview }, updatedAt: new Date() }).where(eq(commercialTasks.id, preparation.id)).returning();
  return { id: task.id, durationUs: preview.durationUs, scenes: preview.scenes };
}

export async function quoteCommercialAnalysis(userId: string, input: { preparationId: string; sceneIds: string[]; payer: string; model: string; outputLanguage: string }) {
  const preparation = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, input.preparationId), eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis_preview"), eq(commercialTasks.state, "quoted")) });
  if (!preparation || preparation.expiresAt.getTime() < Date.now()) throw new Error("QUOTE_EXPIRED");
  const source = preparation.input as { projectId: string; mediaUrl: string; mediaName: string; preview: MediaPreview; automaticSplit: boolean };
  if (!Array.isArray(input.sceneIds) || new Set(input.sceneIds).size !== input.sceneIds.length || input.sceneIds.some((id) => !source.preview.scenes.some((s) => s.id === id))) throw new Error("INVALID_SCENE_SELECTION");
  const pricing: AnalysisPriceInput = { payer: input.payer as AnalysisPriceInput["payer"], model: input.model as AnalysisPriceInput["model"], sourceDurationUs: source.preview.durationUs, automaticSplit: source.automaticSplit, paidSplitReusable: false, scenes: source.preview.scenes.filter((s) => input.sceneIds.includes(s.id)) };
  const quote = quoteAnalysis(pricing);
  const apiKey = pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(userId);
  if (!apiKey) throw new Error("KIE_KEY_REQUIRED");
  const snapshot: AnalysisInput = { ...source, pricing, pricingVersion: PRICING_VERSION, outputLanguage: input.outputLanguage === "zh" ? "zh" : "en", keyFingerprint: generationKeyFingerprint(apiKey) };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "analysis", input: snapshot, credits: quote.credits, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, ...quote, payer: pricing.payer, expiresAt: task.expiresAt };
}

export async function executeCommercialAnalysis(task: typeof commercialTasks.$inferSelect) {
  const input = task.input as AnalysisInput;
  const progress = task.result as { assets?: FfmpegBreakdownResult; versionId?: string; sceneRecords?: Record<string, string>; finishedSceneIds?: string[]; successfulSceneIds?: string[]; splitDelivered?: boolean };
  const finished = progress.finishedSceneIds || [];
  const successes = progress.successfulSceneIds || input.retry?.previousSuccess || [];
  const attempts = input.retry?.sceneVersions.map((s) => s.id) || input.pricing.scenes.map((s) => s.id);
  const next = attempts.find((id) => !finished.includes(id));
  if (!next) {
    await finishCommercialAnalysis(task, successes, Boolean(progress.splitDelivered), successes.length > (input.retry?.previousSuccess.length || 0) ? "completed" : "failed");
    return;
  }
  const apiKey = input.pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(task.userId);
  if (!apiKey || generationKeyFingerprint(apiKey) !== input.keyFingerprint) {
    await finishCommercialAnalysis(task, successes, Boolean(progress.splitDelivered), "failed");
    return;
  }
  if (input.retry) {
    const scene = input.retry.sceneVersions.find((s) => s.id === next)!;
    const result = await retrySceneAnalysis({ userId: task.userId, projectId: input.projectId, sceneVersionId: scene.sceneVersionId, modelMode: "manual", modelId: input.pricing.model === "flash" ? "analysis-gemini-2-5-flash" : "analysis-gemini-2-5-pro", outputLanguage: input.outputLanguage, analysisApiKey: apiKey, allowPlatformKeyForAnalysis: input.pricing.payer === "platform", analysisKeySource: input.pricing.payer === "platform" ? "platform" : "user", forceFreeTrialKie: false });
    const succeeded = (result.metadata as Record<string, unknown>)?.analysisProvider !== "fallback";
    await db.update(commercialTasks).set({ state: "queued", result: { ...progress, successfulSceneIds: succeeded ? [...successes, next] : successes, finishedSceneIds: [...finished, next] }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    return;
  }
  if (!progress.assets) {
    // Asset extraction and inference are separate checkpoints, each bounded to one server invocation.
    let assets: FfmpegBreakdownResult;
    try { assets = await commercialMediaRequest<FfmpegBreakdownResult>(input.mediaUrl, { mode: "assets", sourceHash: input.preview.sourceHash, scenes: input.pricing.scenes }); }
    catch { await finishCommercialAnalysis(task, [], false, "failed"); return; }
    if (assets.scenes.length !== input.pricing.scenes.length || assets.scenes.some((s, index) => Math.abs(s.startTime * 1000000 - input.pricing.scenes[index].startUs) > 1000 || Math.abs(s.endTime * 1000000 - input.pricing.scenes[index].endUs) > 1000)) throw new Error("SPLIT_ASSET_MISMATCH");
    await db.transaction(async (tx) => {
      const [reference] = await tx.insert(referenceVideos).values({ projectId: input.projectId, sourceUrl: input.mediaUrl, fileName: input.mediaName, duration: Math.round(input.preview.durationUs / 1000000), metadata: { ...assets.metadata, sourceHash: input.preview.sourceHash } }).returning();
      const [version] = await tx.insert(projectVersions).values({ projectId: input.projectId, versionNumber: 0, kind: "original", label: input.outputLanguage === "zh" ? "原始版本" : "Original", overview: { sceneCount: input.pricing.scenes.length } }).returning();
      const sceneRecords: Record<string, string> = {};
      for (let index = 0; index < assets.scenes.length; index++) {
        const s = assets.scenes[index];
        const interval = input.pricing.scenes[index];
        const [scene] = await tx.insert(videoScenes).values({ projectId: input.projectId, referenceVideoId: reference.id, sceneIndex: index + 1, startTime: interval.startUs / 1000000, endTime: interval.endUs / 1000000, duration: (interval.endUs - interval.startUs) / 1000000, clipUrl: s.clipUrl, keyframeUrls: s.keyframeUrls, audioUrl: s.audioUrl, status: "queued" }).returning();
        sceneRecords[interval.id] = scene.id;
      }
      await tx.update(projects).set({ activeVersionId: version.id, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
      await tx.update(commercialTasks).set({ state: "queued", result: { assets, splitDelivered: input.pricing.automaticSplit, versionId: version.id, sceneRecords, successfulSceneIds: [], finishedSceneIds: [] }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    });
    return;
  }
  const index = input.pricing.scenes.findIndex((s) => s.id === next);
  const scene = progress.assets.scenes[index];
  if (!progress.versionId || !progress.sceneRecords?.[next]) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
  let blueprint;
  try { blueprint = await analyzeSceneBlueprint({ userId: task.userId, scene, context: { sceneCount: input.pricing.scenes.length }, modelMode: "manual", modelId: input.pricing.model === "flash" ? "analysis-gemini-2-5-flash" : "analysis-gemini-2-5-pro", outputLanguage: input.outputLanguage, analysisApiKey: apiKey, allowPlatformKeyForAnalysis: input.pricing.payer === "platform", analysisKeySource: input.pricing.payer === "platform" ? "platform" : "user", forceFreeTrialKie: false }); }
  catch { blueprint = buildFallbackSceneBlueprint(scene, "Analysis unavailable", undefined, input.outputLanguage); }
  const succeeded = blueprint.metadata?.analysisProvider === "kie";
  await db.transaction(async (tx) => {
    await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId!, originalSceneId: progress.sceneRecords![next], sceneIndex: index + 1, duration: (input.pricing.scenes[index].endUs - input.pricing.scenes[index].startUs) / 1000000, ...blueprint });
    await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : "Analysis unavailable", updatedAt: new Date() }).where(eq(videoScenes.id, progress.sceneRecords![next]));
    await tx.update(commercialTasks).set({ state: "queued", result: { ...progress, successfulSceneIds: succeeded ? [...successes, next] : successes, finishedSceneIds: [...finished, next] }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
  });
}

async function finishCommercialAnalysis(task: typeof commercialTasks.$inferSelect, success: string[], splitDelivered: boolean, state: "completed" | "failed") {
  const input = task.input as AnalysisInput;
  const totalChargedCredits = settleAnalysis(input.pricing, success, splitDelivered);
  const credits = totalChargedCredits - (input.retry?.previousCharged || 0);
  await db.transaction(async (tx) => {
    await tx.select().from(commercialTasks).where(eq(commercialTasks.id, task.id)).for("update");
    await settleCommercialTaskInTransaction(tx, { userId: task.userId, taskKey: `commercial:${task.id}`, credits, rewrites: 0 });
    await tx.update(commercialTasks).set({ state, result: sql`${commercialTasks.result} || ${JSON.stringify({ successfulSceneIds: success, totalChargedCredits, chargedCredits: credits, projectId: input.projectId })}::jsonb`, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    await tx.update(projects).set({ status: "ready", updatedAt: new Date() }).where(eq(projects.id, input.projectId));
  });
}

export async function commercialAnalysisBundle(task: typeof commercialTasks.$inferSelect) {
  return getProjectBundle((task.input as AnalysisInput).projectId, task.userId);
}

export async function quoteCommercialAnalysisRetry(userId: string, parentId: string) {
  const parent = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, parentId), eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis")) });
  if (!parent || !["completed", "failed"].includes(parent.state)) throw new Error("ANALYSIS_NOT_SETTLED");
  const source = parent.input as AnalysisInput;
  const result = parent.result as { assets?: FfmpegBreakdownResult; successfulSceneIds?: string[]; totalChargedCredits?: number; nextTaskId?: string };
  if (result.nextTaskId) throw new Error("USE_LATEST_RETRY_TASK");
  if (!result.assets || !Number.isSafeInteger(result.totalChargedCredits)) throw new Error("SPLIT_ASSETS_NOT_AVAILABLE");
  const previousSuccess = result.successfulSceneIds || [];
  const remaining = source.pricing.scenes.filter((s) => !previousSuccess.includes(s.id));
  if (!remaining.length) throw new Error("NO_FAILED_SCENES");
  const bundle = await getProjectBundle(source.projectId, userId);
  if (!bundle) throw new Error("PROJECT_NOT_FOUND");
  const sceneVersions = remaining.map((scene) => {
    const index = source.pricing.scenes.findIndex((s) => s.id === scene.id) + 1;
    const version = bundle.allSceneVersions.find((s) => s.sceneIndex === index && (s.metadata as Record<string, unknown>)?.analysisProvider === "fallback");
    if (!version) throw new Error("SCENE_ALREADY_CHANGED");
    return { id: scene.id, sceneVersionId: version.id };
  });
  const apiKey = source.pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(userId);
  if (!apiKey) throw new Error("KIE_KEY_REQUIRED");
  const credits = settleAnalysis(source.pricing, source.pricing.scenes.map((s) => s.id), true) - result.totalChargedCredits!;
  const snapshot: AnalysisInput = { ...source, keyFingerprint: generationKeyFingerprint(apiKey), retry: { parentId, previousSuccess, previousCharged: result.totalChargedCredits!, sceneVersions } };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "analysis", input: snapshot, credits, result: { assets: result.assets, splitDelivered: source.pricing.automaticSplit }, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, credits, sceneCount: remaining.length, expiresAt: task.expiresAt };
}
