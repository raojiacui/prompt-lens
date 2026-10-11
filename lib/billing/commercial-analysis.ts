import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ANALYSIS_SAVE_STALE_TIMEOUT_MS, ANALYSIS_STALE_TIMEOUT_MS, AnalysisExecutionLost, executionCondition, lockAnalysisExecution } from "./analysis-execution";
import { db, commercialLots, commercialTasks, projects, referenceVideos, projectVersions, videoScenes, sceneVersions } from "@/lib/db";
import { isOwnedLinkedVideo, commercialMediaRequest, type MediaPreview } from "./commercial-media";
import { quoteAnalysis, settleAnalysis, type AnalysisPriceInput, PRICING_VERSION } from "./pricing-v6";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { getProjectBundle } from "@/lib/workflow/service";
import { analyzeSceneBlueprint, buildFallbackSceneBlueprint, type SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { resolveModelSelection } from "@/lib/ai/model-registry";
import { taskErrorDetails } from "./task-diagnostics";
import { dispatchQueuedAnalysis } from "@/lib/workflow/analysis-dispatch";

export function commercialConsumptionEnabled() { return process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true"; }
type AnalysisInput = { projectId: string; mediaUrl: string; mediaName: string; preview: MediaPreview; pricing: AnalysisPriceInput; modelId?: string; outputLanguage: "zh" | "en"; keyFingerprint: string; pricingVersion: string; retry?: { parentId: string; previousSuccess: string[]; previousCharged: number; sceneVersions: { id: string; sceneVersionId: string }[] } };

export function quotedAnalysisModel(input: { payer: string; model: string; modelId?: string }) {
  const modelId = input.payer === "platform"
    ? input.model === "flash" ? "analysis-gemini-3-8-flash" : "analysis-gemini-2-5-pro"
    : input.modelId || "analysis-gemini-3-8-flash";
  return resolveModelSelection("analysis", { mode: "manual", modelId }).model.kieModelId;
}

function savedAnalysisModel(input: AnalysisInput) {
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
  const snapshot: AnalysisInput = { ...source, pricing, modelId, pricingVersion: PRICING_VERSION, outputLanguage: input.outputLanguage === "zh" ? "zh" : "en", keyFingerprint: generationKeyFingerprint(apiKey) };
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
  const progress = task.result as { assets?: FfmpegBreakdownResult; versionId?: string; sceneRecords?: Record<string, string>; finishedSceneIds?: string[]; successfulSceneIds?: string[]; splitDelivered?: boolean; pendingResult?: { sceneId: string; blueprint: SceneBlueprintDraft } | null };
  const finished = progress.finishedSceneIds || [];
  const successes = progress.successfulSceneIds || input.retry?.previousSuccess || [];
  const attempts = input.retry?.sceneVersions.map((s) => s.id) || input.pricing.scenes.map((s) => s.id);
  const next = attempts.find((id) => !finished.includes(id));
  if (progress.pendingResult && progress.pendingResult.sceneId !== next) throw new Error("ANALYSIS_CHECKPOINT_MISMATCH");
  if (!next) {
    await finishCommercialAnalysis(task, successes, Boolean(progress.splitDelivered), successes.length > (input.retry?.previousSuccess.length || 0) ? "completed" : "failed");
    return;
  }
  await recordAnalysisPhase(task, "resolving_access", next);
  const apiKey = input.pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(task.userId);
  if (!progress.pendingResult && (!apiKey || generationKeyFingerprint(apiKey) !== input.keyFingerprint)) {
    await finishCommercialAnalysis(task, successes, Boolean(progress.splitDelivered), "failed");
    return;
  }
  if (input.retry) {
    const scene = input.retry.sceneVersions.find((s) => s.id === next)!;
    const version = await db.query.sceneVersions.findFirst({ where: and(eq(sceneVersions.id, scene.sceneVersionId), eq(sceneVersions.projectId, input.projectId)) });
    if (!version) throw new Error("SCENE_NOT_FOUND");
    const index = input.pricing.scenes.findIndex(s => s.id === next);
    const asset = progress.assets?.scenes[index];
    if (!asset) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
    let blueprint = progress.pendingResult?.blueprint;
    if (!blueprint) {
      await recordAnalysisPhase(task, "model_request", next);
      try { blueprint = await analyzeSceneBlueprint({ userId: task.userId, scene: asset, context: { sceneCount: input.pricing.scenes.length }, modelMode: "manual", modelId: savedAnalysisModel(input), outputLanguage: input.outputLanguage, analysisApiKey: apiKey || undefined, allowPlatformKeyForAnalysis: input.pricing.payer === "platform", analysisKeySource: input.pricing.payer === "platform" ? "platform" : "user", forceFreeTrialKie: false }); }
      catch (error) { console.error("commercial.analysis.model_failed", { taskId: task.id, sceneId: next, error: taskErrorDetails(error) }); blueprint = buildFallbackSceneBlueprint(asset, "Analysis unavailable", undefined, input.outputLanguage); }
    }
    const succeeded = blueprint.metadata?.analysisProvider === "kie";
    if (!succeeded) console.error("commercial.analysis.fallback", { taskId: task.id, sceneId: next, error: taskErrorDetails(String(blueprint.metadata?.fallbackReason || "Analysis unavailable")) });
    await recordAnalysisPhase(task, "saving_result", next, { pendingResult: { sceneId: next, blueprint } });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', '30s', true), set_config('lock_timeout', '10s', true), set_config('idle_in_transaction_session_timeout', '30s', true)`);
      await lockAnalysisExecution(tx, task);
      await tx.update(sceneVersions).set({ ...blueprint, metadata: { ...blueprint.metadata, retryOfSceneVersionId: version.id }, updatedAt: new Date() }).where(eq(sceneVersions.id, version.id));
      await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : String(blueprint.metadata?.fallbackReason || "Analysis unavailable"), updatedAt: new Date() }).where(eq(videoScenes.id, version.originalSceneId));
      await tx.update(commercialTasks).set({ state: "queued", result: { ...progress, pendingResult: null, successfulSceneIds: succeeded ? [...successes, next] : successes, finishedSceneIds: [...finished, next] }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    });
    return;
  }
  if (!progress.assets) {
    // Asset extraction and inference are separate checkpoints, each bounded to one server invocation.
    let assets: FfmpegBreakdownResult;
    await recordAnalysisPhase(task, "extracting_assets");
    try { assets = await commercialMediaRequest<FfmpegBreakdownResult>(input.mediaUrl, { mode: "assets", sourceHash: input.preview.sourceHash, scenes: input.pricing.scenes }); }
    catch { await finishCommercialAnalysis(task, [], false, "failed"); return; }
    if (assets.scenes.length !== input.pricing.scenes.length || assets.scenes.some((s, index) => Math.abs(s.startTime * 1000000 - input.pricing.scenes[index].startUs) > 1000 || Math.abs(s.endTime * 1000000 - input.pricing.scenes[index].endUs) > 1000)) throw new Error("SPLIT_ASSET_MISMATCH");
    await db.transaction(async (tx) => {
      await lockAnalysisExecution(tx, task);
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
      await tx.update(commercialTasks).set({ state: "queued", result: { ...progress, assets, splitDelivered: input.pricing.automaticSplit, versionId: version.id, sceneRecords, successfulSceneIds: [], finishedSceneIds: [] }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    });
    return;
  }
  const index = input.pricing.scenes.findIndex((s) => s.id === next);
  const scene = progress.assets.scenes[index];
  if (!progress.versionId || !progress.sceneRecords?.[next]) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
  let blueprint = progress.pendingResult?.blueprint;
  if (!blueprint) {
    await recordAnalysisPhase(task, "model_request", next);
    try { blueprint = await analyzeSceneBlueprint({ userId: task.userId, scene, context: { sceneCount: input.pricing.scenes.length }, modelMode: "manual", modelId: savedAnalysisModel(input), outputLanguage: input.outputLanguage, analysisApiKey: apiKey || undefined, allowPlatformKeyForAnalysis: input.pricing.payer === "platform", analysisKeySource: input.pricing.payer === "platform" ? "platform" : "user", forceFreeTrialKie: false }); }
    catch (error) { console.error("commercial.analysis.model_failed", { taskId: task.id, sceneId: next, error: taskErrorDetails(error) }); blueprint = buildFallbackSceneBlueprint(scene, "Analysis unavailable", undefined, input.outputLanguage); }
  }
  const succeeded = blueprint.metadata?.analysisProvider === "kie";
  if (!succeeded) console.error("commercial.analysis.fallback", { taskId: task.id, sceneId: next, error: taskErrorDetails(String(blueprint.metadata?.fallbackReason || "Analysis unavailable")) });
  await recordAnalysisPhase(task, "saving_result", next, { pendingResult: { sceneId: next, blueprint } });
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', '30s', true), set_config('lock_timeout', '10s', true), set_config('idle_in_transaction_session_timeout', '30s', true)`);
    await lockAnalysisExecution(tx, task);
    await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId!, originalSceneId: progress.sceneRecords![next], sceneIndex: index + 1, duration: (input.pricing.scenes[index].endUs - input.pricing.scenes[index].startUs) / 1000000, ...blueprint });
    await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : String(blueprint.metadata?.fallbackReason || "Analysis unavailable"), updatedAt: new Date() }).where(eq(videoScenes.id, progress.sceneRecords![next]));
    await tx.update(commercialTasks).set({ state: "queued", result: { ...progress, pendingResult: null, successfulSceneIds: succeeded ? [...successes, next] : successes, finishedSceneIds: [...finished, next] }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
  });
}

async function finishCommercialAnalysis(task: typeof commercialTasks.$inferSelect, success: string[], splitDelivered: boolean, state: "completed" | "failed", transaction?: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const input = task.input as AnalysisInput;
  const totalChargedCredits = settleAnalysis(input.pricing, success, splitDelivered);
  const credits = totalChargedCredits - (input.retry?.previousCharged || 0);
  const finish = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    await lockAnalysisExecution(tx, task);
    await settleCommercialTaskInTransaction(tx, { userId: task.userId, taskKey: `commercial:${task.id}`, credits, rewrites: 0 });
    await tx.update(commercialTasks).set({ state, result: sql`${commercialTasks.result} || ${JSON.stringify({ successfulSceneIds: success, totalChargedCredits, chargedCredits: credits, projectId: input.projectId })}::jsonb`, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    await tx.update(projects).set({ status: success.length ? "ready" : "failed", metadata: sql`${projects.metadata} || ${JSON.stringify({ failedSceneCount: input.pricing.scenes.length - success.length, partialAnalysis: success.length > 0 && success.length < input.pricing.scenes.length })}::jsonb`, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
  };
  if (transaction) await finish(transaction);
  else await db.transaction(finish);
}

export async function recoverCommercialAnalysisTasks(taskId?: string) {
  if (!taskId) await db.update(commercialTasks).set({ state: "failed", result: { code: "PREVIEW_EXPIRED" }, updatedAt: new Date() }).where(and(eq(commercialTasks.kind, "analysis_preview"), sql`${commercialTasks.state} IN ('running', 'quoted')`, sql`${commercialTasks.expiresAt} < now()`));
  const runningCutoff = new Date(Date.now() - ANALYSIS_STALE_TIMEOUT_MS);
  const saveCutoff = new Date(Date.now() - ANALYSIS_SAVE_STALE_TIMEOUT_MS);
  const expired = sql`((${commercialTasks.state} IN ('running', 'review') AND (${commercialTasks.updatedAt} < ${runningCutoff}
    OR (${commercialTasks.updatedAt} < ${saveCutoff} AND ${commercialTasks.result}->'pendingResult' IS NOT NULL AND ${commercialTasks.result}->'pendingResult' <> 'null'::jsonb)))
    OR (${commercialTasks.state} = 'queued' AND ${commercialTasks.updatedAt} < now() - interval '24 hours'))`;
  const stale = await db.select().from(commercialTasks).where(and(eq(commercialTasks.kind, "analysis"), taskId ? eq(commercialTasks.id, taskId) : undefined, expired)).limit(taskId ? 1 : 10);
  const resumed: string[] = [];
  for (const candidate of stale) {
    await db.transaction(async (tx) => {
    const [task] = await tx.update(commercialTasks).set({ state: "running", result: sql`${commercialTasks.result} || ${JSON.stringify({ executionId: randomUUID() })}::jsonb`, updatedAt: new Date() }).where(and(eq(commercialTasks.id, candidate.id), expired)).returning();
    if (!task) return;
    const checkpoint = task.result as Record<string, unknown>;
    if (checkpoint.pendingResult) {
      await tx.update(commercialTasks).set({ state: "queued", result: sql`${commercialTasks.result} || ${JSON.stringify({ executionPhase: "resuming_save", saveRecoveryCount: Number(checkpoint.saveRecoveryCount || 0) + 1 })}::jsonb`, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
      resumed.push(task.id);
      console.warn("commercial.analysis.resuming_save", { taskId: task.id, sceneId: checkpoint.activeSceneId });
      return;
    }
    const input = task.input as AnalysisInput;
    const recordedPhase = (task.result as Record<string, unknown>).executionPhase;
    const interruptedPhase = typeof recordedPhase === "string" ? recordedPhase : "unknown";
    const interruptedReason = input.outputLanguage === "zh" ? "分析任务中断，未能保存模型分析结果，请重试失败镜头。" : "Analysis interrupted before its result was saved. Retry the failed shot.";
    const progress = task.result as { assets?: FfmpegBreakdownResult; versionId?: string; sceneRecords?: Record<string, string>; successfulSceneIds?: string[]; finishedSceneIds?: string[]; splitDelivered?: boolean; activeSceneId?: string };
    const successes = progress.successfulSceneIds || input.retry?.previousSuccess || [];
    const attempts = input.retry?.sceneVersions.map(scene => scene.id) || input.pricing.scenes.map(scene => scene.id);
    const finished = progress.finishedSceneIds || [];
    const next = attempts.find(id => !finished.includes(id));
    const inferenceMayHaveStarted = !["resolving_access", "extracting_assets"].includes(interruptedPhase);
    const interrupted = inferenceMayHaveStarted
      ? progress.activeSceneId && !finished.includes(progress.activeSceneId) && attempts.includes(progress.activeSceneId) ? progress.activeSceneId : next
      : null;
    const canRecordInterrupted = Boolean(interrupted && progress.assets && (input.retry || (progress.versionId && progress.sceneRecords?.[interrupted])));
    if (interrupted && canRecordInterrupted && progress.assets) {
      const index = input.pricing.scenes.findIndex(scene => scene.id === interrupted);
      const interval = input.pricing.scenes[index];
      const fallback = buildFallbackSceneBlueprint(progress.assets.scenes[index], interruptedReason, undefined, input.outputLanguage);
      const metadata = { ...fallback.metadata, failureCode: "ANALYSIS_INTERRUPTED", interruptedPhase };
      if (input.retry) {
        const retryScene = input.retry.sceneVersions.find(scene => scene.id === interrupted)!;
        const [version] = await tx.select().from(sceneVersions).where(and(eq(sceneVersions.id, retryScene.sceneVersionId), eq(sceneVersions.projectId, input.projectId))).for("update");
        if (!version) throw new Error("SCENE_NOT_FOUND");
        await tx.update(sceneVersions).set({ ...fallback, metadata: { ...metadata, retryOfSceneVersionId: version.id }, updatedAt: new Date() }).where(eq(sceneVersions.id, version.id));
        await tx.update(videoScenes).set({ status: "failed", error: interruptedReason, updatedAt: new Date() }).where(eq(videoScenes.id, version.originalSceneId));
      } else if (progress.versionId && progress.sceneRecords?.[interrupted]) {
        const originalSceneId = progress.sceneRecords[interrupted];
        const existing = await tx.query.sceneVersions.findFirst({ where: and(eq(sceneVersions.projectVersionId, progress.versionId), eq(sceneVersions.originalSceneId, originalSceneId)) });
        if (!existing) await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId, originalSceneId, sceneIndex: index + 1, duration: (interval.endUs - interval.startUs) / 1_000_000, ...fallback, metadata });
        await tx.update(videoScenes).set({ status: "failed", error: interruptedReason, updatedAt: new Date() }).where(eq(videoScenes.id, originalSceneId));
      }
    }
    const nextFinished = canRecordInterrupted && interrupted ? [...finished, interrupted] : finished;
    const more = attempts.some(id => !nextFinished.includes(id));
    await tx.update(commercialTasks).set({ state: more ? "queued" : "running", result: { ...checkpoint, finishedSceneIds: nextFinished, interruptedSceneId: interrupted || null, interruptionPhase: interruptedPhase }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    if (more) {
      resumed.push(task.id);
      console.warn("commercial.analysis.resuming_remaining", { taskId: task.id, interruptedSceneId: interrupted || null, remainingScenes: attempts.length - nextFinished.length });
    } else {
      await finishCommercialAnalysis(task, successes, Boolean(progress.splitDelivered), successes.length > (input.retry?.previousSuccess.length || 0) ? "completed" : "failed", tx);
    }
    });
  }
  if (!taskId) for (const id of resumed) await dispatchQueuedAnalysis(id);
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
  const snapshot: AnalysisInput = { ...source, keyFingerprint: generationKeyFingerprint(apiKey), retry: { parentId, previousSuccess, previousCharged: result.totalChargedCredits!, sceneVersions } };
  const [task] = await db.insert(commercialTasks).values({ userId, kind: "analysis", input: snapshot, credits, result: { assets: result.assets, splitDelivered: source.pricing.automaticSplit }, expiresAt: new Date(Date.now() + 600000) }).returning();
  return { id: task.id, credits, sceneCount: remaining.length, expiresAt: task.expiresAt };
}
