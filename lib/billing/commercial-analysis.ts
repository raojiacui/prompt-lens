import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ANALYSIS_SAVE_STALE_TIMEOUT_MS, ANALYSIS_STALE_TIMEOUT_MS, AnalysisExecutionLost, executionCondition, lockAnalysisExecution } from "./analysis-execution";
import { db, analysisSceneJobs, commercialLots, commercialTasks, projects, referenceVideos, projectVersions, videoScenes, sceneVersions } from "@/lib/db";
import { isOwnedLinkedVideo, commercialMediaRequest, type MediaPreview } from "./commercial-media";
import { quoteAnalysis, settleAnalysis, type AnalysisPriceInput, PRICING_VERSION } from "./pricing-v6";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { getProjectBundle } from "@/lib/workflow/service";
import { buildFallbackSceneBlueprint, type SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { resolveModelSelection } from "@/lib/ai/model-registry";
import { taskErrorDetails } from "./task-diagnostics";
import { dispatchQueuedAnalysis } from "@/lib/workflow/analysis-dispatch";
import { dispatchQueuedSceneJobs } from "./independent-scene-analysis";

export function commercialConsumptionEnabled() { return process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true"; }
export type AnalysisInput = { projectId: string; mediaUrl: string; mediaName: string; preview: MediaPreview; pricing: AnalysisPriceInput; modelId?: string; outputLanguage: "zh" | "en"; keyFingerprint: string; pricingVersion: string; executionMode?: "scene_jobs_v1"; retry?: { parentId: string; previousSuccess: string[]; previousCharged: number; sceneVersions: { id: string; sceneVersionId: string }[] } };

export function quotedAnalysisModel(input: { payer: string; model: string; modelId?: string }) {
  const modelId = input.payer === "platform"
    ? input.model === "flash" ? "analysis-gemini-3-8-flash" : "analysis-gemini-2-5-pro"
    : input.modelId || "analysis-gemini-3-8-flash";
  return resolveModelSelection("analysis", { mode: "manual", modelId }).model.kieModelId;
}

export function savedAnalysisModel(input: AnalysisInput) {
  // Quotes created before model snapshots were introduced retain their original model.
  return input.modelId || (input.pricing.model === "flash" ? "gemini-2.5-flash" : "gemini-2.5-pro");
}

export async function prepareCommercialAnalysis(userId: string, input: { projectId: string; mediaUrl: string; mediaName: string; automaticSplit: boolean }) {
  if (!commercialConsumptionEnabled()) throw new Error("COMMERCIAL_NOT_ENABLED");
  const linkedVideo = await isOwnedLinkedVideo(userId, input.mediaUrl);
  if (linkedVideo && !input.automaticSplit) throw new Error("INVALID_ANALYSIS_SOURCE_MODE");
  if (input.automaticSplit) {
    const purchase = await db.query.commercialLots.findFirst({ where: and(eq(commercialLots.userId, userId), eq(commercialLots.state, "active"), sql`${commercialLots.availableCredits} > 0`) });
    if (!purchase) throw new Error("SPLIT_PAYMENT_REQUIRED");
  }
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
  try {
  const preview = await commercialMediaRequest<MediaPreview>(input.mediaUrl, { mode: "preview", automaticSplit: input.automaticSplit });
  // Validate worker quantities using the exact same billing validator before storing them.
  quoteAnalysis({ payer: input.automaticSplit ? "byok_split" : "byok", model: "flash", sourceDurationUs: preview.durationUs, automaticSplit: input.automaticSplit, paidSplitReusable: false, scenes: preview.scenes });
  if (!/^[0-9a-f]{64}$/.test(preview.sourceHash) || !Number.isSafeInteger(preview.bytes) || preview.bytes <= 0 || preview.bytes > 100 * 1024 * 1024) throw new Error("INVALID_MEDIA_PROBE");
  const [task] = await db.update(commercialTasks).set({ state: "quoted", input: { ...input, preview }, updatedAt: new Date() }).where(and(eq(commercialTasks.id, preparation.id), eq(commercialTasks.state, "running"), sql`${commercialTasks.expiresAt} > now()`)).returning();
  if (!task) throw new Error("PREVIEW_EXPIRED");
  return { id: task.id, durationUs: preview.durationUs, scenes: preview.scenes };
  } catch (error) {
    await db.update(commercialTasks).set({ state: "failed", result: { code: "MEDIA_PREPARATION_FAILED" }, updatedAt: new Date() }).where(and(eq(commercialTasks.id, preparation.id), eq(commercialTasks.state, "running")));
    throw error;
  }
}

export async function quoteCommercialAnalysis(userId: string, input: { preparationId: string; sceneIds: string[]; payer: string; model: string; modelId?: string; outputLanguage: string }) {
  const preparation = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, input.preparationId), eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis_preview"), eq(commercialTasks.state, "quoted")) });
  if (!preparation || preparation.expiresAt.getTime() < Date.now()) throw new Error("QUOTE_EXPIRED");
  const source = preparation.input as { projectId: string; mediaUrl: string; mediaName: string; preview: MediaPreview; automaticSplit: boolean };
  if (!Array.isArray(input.sceneIds) || new Set(input.sceneIds).size !== input.sceneIds.length || input.sceneIds.some((id) => !source.preview.scenes.some((s) => s.id === id))) throw new Error("INVALID_SCENE_SELECTION");
  const pricing: AnalysisPriceInput = { payer: input.payer as AnalysisPriceInput["payer"], model: input.model as AnalysisPriceInput["model"], sourceDurationUs: source.preview.durationUs, automaticSplit: source.automaticSplit, paidSplitReusable: false, scenes: source.preview.scenes.filter((s) => input.sceneIds.includes(s.id)) };
  const quote = quoteAnalysis(pricing);
  const apiKey = pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(userId);
  if (!apiKey) throw new Error("KIE_KEY_REQUIRED");
  const modelId = quotedAnalysisModel(input);
  const snapshot: AnalysisInput = { ...source, pricing, modelId, pricingVersion: PRICING_VERSION, outputLanguage: input.outputLanguage === "zh" ? "zh" : "en", keyFingerprint: generationKeyFingerprint(apiKey), executionMode: "scene_jobs_v1" };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "analysis", input: snapshot, credits: quote.credits, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, ...quote, modelId, payer: pricing.payer, expiresAt: task.expiresAt };
}

async function recordAnalysisPhase(task: typeof commercialTasks.$inferSelect, phase: string, sceneId?: string, checkpoint: Record<string, unknown> = {}) {
  const marker = { ...checkpoint, executionPhase: phase, phaseStartedAt: new Date().toISOString(), activeSceneId: sceneId || null };
  const [current] = await db.update(commercialTasks).set({ result: sql`${commercialTasks.result} || ${JSON.stringify(marker)}::jsonb`, updatedAt: new Date() }).where(executionCondition(task)).returning({ id: commercialTasks.id });
  if (!current) throw new AnalysisExecutionLost();
  const previous = task.result as Record<string, unknown>;
  console.info("commercial.analysis.phase", { taskId: task.id, sceneId: sceneId || null, phase, previousPhase: previous.executionPhase || null, elapsedMs: typeof previous.phaseStartedAt === "string" ? Date.now() - Date.parse(previous.phaseStartedAt) : null });
  task.result = { ...previous, ...marker };
}

export async function executeCommercialAnalysis(task: typeof commercialTasks.$inferSelect) {
  const input = task.input as AnalysisInput;
  const progress = task.result as { assets?: FfmpegBreakdownResult; versionId?: string; sceneRecords?: Record<string, string>; sceneJobMode?: string; finishedSceneIds?: string[]; successfulSceneIds?: string[]; splitDelivered?: boolean; pendingResult?: { sceneId: string; blueprint: SceneBlueprintDraft } | null };
  if (progress.sceneJobMode === "independent_v1") {
    await dispatchQueuedSceneJobs(task.id);
    return;
  }
  let assets = progress.assets;
  if (!assets) {
    if (input.retry) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
    await recordAnalysisPhase(task, "extracting_assets");
    try { assets = await commercialMediaRequest<FfmpegBreakdownResult>(input.mediaUrl, { mode: "assets", sourceHash: input.preview.sourceHash, scenes: input.pricing.scenes }); }
    catch (error) {
      const diagnostic = { phase: "extracting_assets", error: taskErrorDetails(error) };
      console.error("commercial.analysis.assets_failed", { taskId: task.id, ...diagnostic });
      const [current] = await db.update(commercialTasks).set({ result: sql`${commercialTasks.result} || ${JSON.stringify({ code: "MEDIA_PREPARATION_FAILED", diagnostic })}::jsonb`, updatedAt: new Date() }).where(executionCondition(task)).returning({ id: commercialTasks.id });
      if (!current) throw new AnalysisExecutionLost();
      await finishCommercialAnalysis(task, [], false, "failed");
      return;
    }
  }
  if (assets.scenes.length !== input.pricing.scenes.length || assets.scenes.some((s, index) => Math.abs(s.startTime * 1000000 - input.pricing.scenes[index].startUs) > 1000 || Math.abs(s.endTime * 1000000 - input.pricing.scenes[index].endUs) > 1000)) throw new Error("SPLIT_ASSET_MISMATCH");
  const extracted = assets;
  await db.transaction(async (tx) => {
    await lockAnalysisExecution(tx, task);
    let versionId = progress.versionId;
    const sceneRecords = { ...progress.sceneRecords };
    if (input.retry) {
      for (const retry of input.retry.sceneVersions) {
        const version = await tx.query.sceneVersions.findFirst({ where: and(eq(sceneVersions.id, retry.sceneVersionId), eq(sceneVersions.projectId, input.projectId)) });
        if (!version || (!(progress.finishedSceneIds || []).includes(retry.id) && (version.metadata as Record<string, unknown>).analysisProvider !== "fallback")) throw new Error("SCENE_ALREADY_CHANGED");
        versionId = version.projectVersionId;
        sceneRecords[retry.id] = version.originalSceneId;
      }
    } else if (!versionId) {
      const [reference] = await tx.insert(referenceVideos).values({ projectId: input.projectId, sourceUrl: input.mediaUrl, fileName: input.mediaName, duration: Math.round(input.preview.durationUs / 1000000), metadata: { ...extracted.metadata, sourceHash: input.preview.sourceHash } }).returning();
      const [version] = await tx.insert(projectVersions).values({ projectId: input.projectId, versionNumber: 0, kind: "original", label: input.outputLanguage === "zh" ? "原始版本" : "Original", overview: { sceneCount: input.pricing.scenes.length } }).returning();
      versionId = version.id;
      for (let index = 0; index < extracted.scenes.length; index++) {
        const s = extracted.scenes[index];
        const interval = input.pricing.scenes[index];
        const [scene] = await tx.insert(videoScenes).values({ projectId: input.projectId, referenceVideoId: reference.id, sceneIndex: index + 1, startTime: interval.startUs / 1000000, endTime: interval.endUs / 1000000, duration: (interval.endUs - interval.startUs) / 1000000, clipUrl: s.clipUrl, keyframeUrls: s.keyframeUrls, audioUrl: s.audioUrl, status: "queued" }).returning();
        sceneRecords[interval.id] = scene.id;
      }
      await tx.update(projects).set({ activeVersionId: versionId, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
    }
    if (!versionId) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
    const attempts = input.retry?.sceneVersions.map(scene => scene.id) || input.pricing.scenes.map(scene => scene.id);
    const finished = progress.finishedSceneIds || [];
    const successes = progress.successfulSceneIds || input.retry?.previousSuccess || [];
    // Adopt durable historical checkpoints once; all remaining inference uses scene jobs.
    await tx.insert(analysisSceneJobs).values(attempts.map(sceneId => {
      const pending = progress.pendingResult?.sceneId === sceneId ? progress.pendingResult.blueprint : undefined;
      return { taskId: task.id, sceneId, sceneIndex: input.pricing.scenes.findIndex(scene => scene.id === sceneId) + 1,
        state: finished.includes(sceneId) ? successes.includes(sceneId) ? "completed" : "failed" : pending ? "running" : "queued",
        executionId: pending ? randomUUID() : null, result: pending ? { pendingBlueprint: pending } : {},
        updatedAt: pending ? new Date(Date.now() - 25_000) : new Date() };
    }));
    await tx.update(commercialTasks).set({ state: "running", input: { ...input, executionMode: "scene_jobs_v1" }, result: { ...progress, assets: extracted, pendingResult: null, splitDelivered: progress.splitDelivered ?? input.pricing.automaticSplit, versionId, sceneRecords, successfulSceneIds: successes, finishedSceneIds: finished, executionPhase: "scene_jobs_waiting", sceneJobMode: "independent_v1" }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
  });
  try { await dispatchQueuedSceneJobs(task.id); }
  catch (error) { console.error("commercial.analysis.initial_dispatch_failed", { taskId: task.id, error: taskErrorDetails(error) }); }
}

export async function finishCommercialAnalysis(task: typeof commercialTasks.$inferSelect, success: string[], splitDelivered: boolean, state: "completed" | "failed", transaction?: Parameters<Parameters<typeof db.transaction>[0]>[0], finishedSceneIds?: string[]) {
  const input = task.input as AnalysisInput;
  const totalChargedCredits = settleAnalysis(input.pricing, success, splitDelivered);
  const credits = totalChargedCredits - (input.retry?.previousCharged || 0);
  const hadReview = Boolean((task.result as Record<string, unknown>).review);
  const finish = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    await lockAnalysisExecution(tx, task);
    await settleCommercialTaskInTransaction(tx, { userId: task.userId, taskKey: `commercial:${task.id}`, credits, rewrites: 0 });
    const resolvedAt = new Date();
    const settlementResult = { successfulSceneIds: success, ...(finishedSceneIds ? { finishedSceneIds } : {}), totalChargedCredits, chargedCredits: credits, projectId: input.projectId, ...(hadReview ? { reviewResolution: { action: "automatic_settlement", at: resolvedAt.toISOString(), chargedCredits: credits } } : {}) };
    const result = hadReview
      ? sql`jsonb_set(${commercialTasks.result} || ${JSON.stringify(settlementResult)}::jsonb, '{reviewHistory}', COALESCE(${commercialTasks.result}->'reviewHistory', '[]'::jsonb) || ${JSON.stringify([{ at: resolvedAt.toISOString(), action: "automatic_settlement", chargedCredits: credits }])}::jsonb)`
      : sql`${commercialTasks.result} || ${JSON.stringify(settlementResult)}::jsonb`;
    await tx.update(commercialTasks).set({ state, result, updatedAt: resolvedAt }).where(eq(commercialTasks.id, task.id));
    await tx.update(projects).set({ status: success.length ? "ready" : "failed", metadata: sql`${projects.metadata} || ${JSON.stringify({ failedSceneCount: input.pricing.scenes.length - success.length, partialAnalysis: success.length > 0 && success.length < input.pricing.scenes.length })}::jsonb`, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
  };
  if (transaction) await finish(transaction);
  else await db.transaction(finish);
}

export async function recoverCommercialAnalysisTasks(taskId?: string, options: { dispatch?: boolean; limit?: number; deadline?: number } = {}) {
  if (!taskId) await db.update(commercialTasks).set({ state: "failed", result: { code: "PREVIEW_EXPIRED" }, updatedAt: new Date() }).where(and(eq(commercialTasks.kind, "analysis_preview"), sql`${commercialTasks.state} IN ('running', 'quoted')`, sql`${commercialTasks.expiresAt} < now()`));
  const runningCutoff = new Date(Date.now() - ANALYSIS_STALE_TIMEOUT_MS);
  const saveCutoff = new Date(Date.now() - ANALYSIS_SAVE_STALE_TIMEOUT_MS);
  const expired = sql`(${commercialTasks.result}->>'sceneJobMode' IS DISTINCT FROM 'independent_v1' AND ((${commercialTasks.state} IN ('running', 'review') AND (${commercialTasks.updatedAt} < ${runningCutoff.toISOString()}::timestamptz
    OR (${commercialTasks.updatedAt} < ${saveCutoff.toISOString()}::timestamptz AND ${commercialTasks.result}->'pendingResult' IS NOT NULL AND ${commercialTasks.result}->'pendingResult' <> 'null'::jsonb)))
    OR (${commercialTasks.state} = 'queued' AND ${commercialTasks.updatedAt} < now() - interval '24 hours')))`;
  const stale = await db.select().from(commercialTasks).where(and(eq(commercialTasks.kind, "analysis"), taskId ? eq(commercialTasks.id, taskId) : undefined, expired, sql`(${commercialTasks.result}->>'recoveryRetryAt' IS NULL OR (${commercialTasks.result}->>'recoveryRetryAt')::timestamptz <= now())`)).orderBy(asc(commercialTasks.updatedAt)).limit(taskId ? 1 : options.limit ?? 10);
  const resumed: string[] = [];
  for (const candidate of stale) {
    if (options.deadline && Date.now() >= options.deadline) break;
    try {
    await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', '15s', true), set_config('lock_timeout', '5s', true)`);
    const [task] = await tx.update(commercialTasks).set({ state: "running", result: sql`${commercialTasks.result} || ${JSON.stringify({ executionId: randomUUID() })}::jsonb`, updatedAt: new Date() }).where(and(eq(commercialTasks.id, candidate.id), expired)).returning();
    if (!task) return;
    const checkpoint = task.result as Record<string, unknown>;
    const input = task.input as AnalysisInput;
    const progress = task.result as { assets?: FfmpegBreakdownResult; finishedSceneIds?: string[]; activeSceneId?: string };
    let pendingResult = checkpoint.pendingResult;
    // Fence an interrupted historical request without sending it to KIE again.
    if (!pendingResult && progress.assets && !["resolving_access", "extracting_assets"].includes(String(checkpoint.executionPhase))) {
      const attempts = input.retry?.sceneVersions.map(scene => scene.id) || input.pricing.scenes.map(scene => scene.id);
      const finished = progress.finishedSceneIds || [];
      const interrupted = progress.activeSceneId || attempts.find(id => !finished.includes(id));
      if (interrupted && attempts.includes(interrupted) && !finished.includes(interrupted)) {
        const asset = progress.assets.scenes[input.pricing.scenes.findIndex(scene => scene.id === interrupted)];
        if (!asset) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
        const fallback = buildFallbackSceneBlueprint(asset, "Analysis interrupted", undefined, input.outputLanguage);
        pendingResult = { sceneId: interrupted, blueprint: { ...fallback, metadata: { ...fallback.metadata, failureCode: "ANALYSIS_INTERRUPTED", providerOutcome: "unknown" } } };
      }
    }
    await tx.update(commercialTasks).set({ state: "queued", result: { ...checkpoint, pendingResult: pendingResult || null }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    resumed.push(task.id);
    });
    } catch (error) {
      console.error("commercial.analysis.recovery_failed", { taskId: candidate.id, error });
      try {
        await db.update(commercialTasks).set({ result: sql`${commercialTasks.result} || ${JSON.stringify({ recoveryRetryAt: new Date(Date.now() + 5 * 60_000).toISOString() })}::jsonb` }).where(and(eq(commercialTasks.id, candidate.id), eq(commercialTasks.state, candidate.state), eq(commercialTasks.updatedAt, candidate.updatedAt)));
      } catch (recordError) { console.error("commercial.analysis.recovery_defer_failed", { taskId: candidate.id, error: recordError }); }
    }
  }
  if (!taskId && options.dispatch !== false) for (const id of resumed) await dispatchQueuedAnalysis(id);
}

export async function commercialAnalysisBundle(task: typeof commercialTasks.$inferSelect) {
  return getProjectBundle((task.input as AnalysisInput).projectId, task.userId);
}

export async function quoteCommercialAnalysisRetry(userId: string, parentId: string, sceneVersionId?: string) {
  const parent = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, parentId), eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis")) });
  if ((parent?.result as Record<string, unknown> | undefined)?.retentionExpired) throw new Error("PROJECT_CONTENT_EXPIRED");
  if (!parent || !["completed", "failed"].includes(parent.state)) throw new Error("ANALYSIS_NOT_SETTLED");
  const source = parent.input as AnalysisInput;
  const result = parent.result as { assets?: FfmpegBreakdownResult; successfulSceneIds?: string[]; totalChargedCredits?: number; nextTaskId?: string };
  if (result.nextTaskId) throw new Error("USE_LATEST_RETRY_TASK");
  if (!result.assets || !Number.isSafeInteger(result.totalChargedCredits)) throw new Error("SPLIT_ASSETS_NOT_AVAILABLE");
  const previousSuccess = result.successfulSceneIds || [];
  let remaining = source.pricing.scenes.filter((s) => !previousSuccess.includes(s.id));
  if (!remaining.length) throw new Error("NO_FAILED_SCENES");
  const bundle = await getProjectBundle(source.projectId, userId);
  if (!bundle) throw new Error("PROJECT_NOT_FOUND");
  if (sceneVersionId) {
    const selected = bundle.sceneVersions.find(version => version.id === sceneVersionId);
    if (!selected || (selected.metadata as Record<string, unknown>)?.analysisProvider !== "fallback") throw new Error("SCENE_ALREADY_CHANGED");
    remaining = remaining.filter(scene => source.pricing.scenes.findIndex(item => item.id === scene.id) + 1 === selected.sceneIndex);
    if (!remaining.length) throw new Error("NO_FAILED_SCENES");
  }
  const sceneVersions = remaining.map((scene) => {
    const index = source.pricing.scenes.findIndex((s) => s.id === scene.id) + 1;
    const version = bundle.sceneVersions.find((s) => s.sceneIndex === index && (s.metadata as Record<string, unknown>)?.analysisProvider === "fallback");
    if (!version) throw new Error("SCENE_ALREADY_CHANGED");
    return { id: scene.id, sceneVersionId: version.id };
  });
  const apiKey = source.pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(userId);
  if (!apiKey) throw new Error("KIE_KEY_REQUIRED");
  const credits = settleAnalysis(source.pricing, [...previousSuccess, ...remaining.map(scene => scene.id)], true) - result.totalChargedCredits!;
  const snapshot: AnalysisInput = { ...source, executionMode: "scene_jobs_v1", keyFingerprint: generationKeyFingerprint(apiKey), retry: { parentId, previousSuccess, previousCharged: result.totalChargedCredits!, sceneVersions } };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "analysis", input: snapshot, credits, result: { assets: result.assets, splitDelivered: source.pricing.automaticSplit }, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, credits, sceneCount: remaining.length, expiresAt: task.expiresAt };
}
