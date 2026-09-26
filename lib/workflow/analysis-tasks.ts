import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { commercialTasks, creditLedger, db, operationLogs, projects, projectVersions, referenceVideos, sceneVersions, trialAnalysisReservations, trialAnalysisUsage, userCredits, videoScenes } from "@/lib/db";
import { assertCanStartVideoAnalysis, FREE_TRIAL_ANALYSIS_MODEL, getVideoAnalysisChargeUnits, type VideoAnalysisBillingMode } from "@/lib/billing/video-analysis";
import { getPlatformKieApiKey, resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";
import { assertOwnedUploadedVideo, commercialMediaRequest, type MediaPreview } from "@/lib/billing/commercial-media";
import { generationKeyFingerprint } from "@/lib/billing/generation-key";
import { InsufficientCreditsError } from "@/lib/billing/credits";
import { reserveTrialAnalysis, releaseTrialAnalysis } from "@/lib/usage/trial-quota";
import { resolveModelSelection } from "@/lib/ai/model-registry";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { analyzeImageBlueprint, analyzeSceneBlueprint, buildFallbackSceneBlueprint, type SceneBlueprintDraft } from "./scene-analysis";
import { parseWorkflowModelSelection } from "./model-selection";
import { buildSceneAudioContexts, transcribeMediaWithKie, type KieTranscriptionResult } from "./transcription";
import { recognizeBackgroundMusic, type BackgroundMusicRecognition } from "./music-recognition";
import { requiresAnalysisQuote } from "./analysis-routing";
import { attachBackgroundMusicToBlueprint, deriveProjectTitle } from "./service";

type Task = typeof commercialTasks.$inferSelect;
type Input = {
  projectId: string; mediaUrl: string; mediaName?: string; mediaType: "image" | "video";
  mode: VideoAnalysisBillingMode; modelId: string; keySource: "user" | "platform"; keyFingerprint: string;
  outputLanguage: "zh" | "en"; longVideoAllowed: boolean; trialReservationId: string | null;
};
type Progress = {
  phase: "prepare" | "assets" | "transcription" | "music" | "scenes" | "settle";
  preview?: MediaPreview; assets?: FfmpegBreakdownResult; versionId?: string; sceneIds?: string[];
  cursor: number; successful: number; failed: number; heldCredits: number; chargedCredits?: number;
  transcription?: KieTranscriptionResult | null; transcriptionError?: string; music?: BackgroundMusicRecognition;
  error?: string; projectId?: string; partial?: boolean;
};
const LEASE_MS = 6 * 60_000;

async function taskKey(input: Input, userId: string) {
  const key = input.keySource === "platform" ? getPlatformKieApiKey() : (await resolveKieApiKeyForFeature(userId, { allowPaidPlatformKey: false })).apiKey;
  if (!key || generationKeyFingerprint(key) !== input.keyFingerprint) throw new Error("KIE Key 已变更，请重新提交分析。");
  return key;
}

export async function enqueueAnalysis(userId: string, projectId: string, body: Record<string, unknown>) {
  // One initial analysis per project makes retries of a lost submission idempotent.
  const existing = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "workflow_analysis"), sql`${commercialTasks.input}->>'projectId' = ${projectId}`) });
  if (existing) return existing;
  const mediaType = body.mediaType === "image" ? "image" : "video";
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";
  await assertOwnedUploadedVideo(userId, mediaUrl, mediaType);
  const longVideo = mediaType === "video" && !(typeof body.mediaDuration === "number" && body.mediaDuration > 0 && body.mediaDuration <= 10.75);
  const entitlement = await assertCanStartVideoAnalysis(userId, { longVideo: false });
  if (requiresAnalysisQuote({ commercialEnabled: process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true", mediaType, mode: entitlement.mode, longVideo, trialRemaining: entitlement.trial.remaining })) throw new Error("CONFIRMED_QUOTE_REQUIRED");
  const access = entitlement.mode === "trial" ? { apiKey: getPlatformKieApiKey(), source: "platform" } : await resolveKieApiKeyForFeature(userId, { requiredPackageScope: "video_analysis" });
  if (!access.apiKey) throw new Error("KIE API Key is not configured");
  const selection = parseWorkflowModelSelection(body);
  const modelId = entitlement.mode === "trial" ? FREE_TRIAL_ANALYSIS_MODEL : resolveModelSelection("analysis", { mode: selection.modelMode, modelId: selection.modelId, priority: selection.modelPriority }).model.kieModelId;
  const id = randomUUID();
  let reservation: string | null = null;
  try {
    if (entitlement.mode === "trial") reservation = await reserveTrialAnalysis(userId, `analysis:${id}`);
    return await db.transaction(async (tx) => {
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).for("update");
      if (!project || project.status !== "draft") throw new Error("PROJECT_NOT_READY");
      const input: Input = { projectId, mediaUrl, mediaType, mediaName: typeof body.mediaName === "string" ? body.mediaName : undefined,
        mode: entitlement.mode, modelId, outputLanguage: body.outputLanguage === "en" ? "en" : "zh",
        longVideoAllowed: entitlement.capabilities.videoAnalysis.canUseLongVideo,
        keySource: access.source === "user" ? "user" : "platform", keyFingerprint: generationKeyFingerprint(access.apiKey!), trialReservationId: reservation };
      const result: Progress = { phase: "prepare", cursor: 0, successful: 0, failed: 0, heldCredits: 0, projectId };
      const [task] = await tx.insert(commercialTasks).values({ id, userId, kind: "workflow_analysis", state: "queued", input, result, expiresAt: new Date(Date.now() + 24 * 3600_000) }).returning();
      await tx.update(projects).set({ status: "analyzing", metadata: { ...project.metadata as Record<string, unknown>, analysisTaskId: id, mediaType, analysisModel: modelId }, updatedAt: new Date() }).where(eq(projects.id, projectId));
      return task;
    });
  } catch (error) {
    if (reservation) await releaseTrialAnalysis(reservation);
    const duplicate = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "workflow_analysis"), sql`${commercialTasks.input}->>'projectId' = ${projectId}`) });
    if (duplicate) return duplicate;
    throw error;
  }
}

async function saveCheckpoint(task: Task, progress: Progress) {
  await db.update(commercialTasks).set({ state: "queued", result: progress, updatedAt: new Date() }).where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "running")));
}

async function settleAnalysisTask(task: Task, progress: Progress) {
  const input = task.input as Input;
  progress = { ...progress, failed: Math.max(progress.failed, (progress.assets?.scenes.length || 0) - progress.successful) };
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(commercialTasks).where(eq(commercialTasks.id, task.id)).for("update");
    if (!current || ["completed", "failed"].includes(current.state)) return;
    const chargedCredits = input.mode === "platform_credits" && progress.successful > 0
      ? getVideoAnalysisChargeUnits({ sceneCount: progress.successful, longVideo: (progress.preview?.durationUs || 0) > 10_750_000 }) : 0;
    const refund = progress.heldCredits - chargedCredits;
    if (refund < 0) throw new Error("Analysis settlement exceeds reservation");
    if (refund) {
      const [wallet] = await tx.update(userCredits).set({ balance: sql`${userCredits.balance} + ${refund}`, lifetimeUsed: sql`${userCredits.lifetimeUsed} - ${refund}`, updatedAt: new Date() }).where(eq(userCredits.userId, task.userId)).returning();
      await tx.insert(creditLedger).values({ userId: task.userId, type: "admin_adjustment", amount: refund, balanceAfter: wallet.balance, note: "退回未成功分析的预留积分", metadata: { taskId: task.id } });
    }
    if (input.trialReservationId) {
      const [reservation] = await tx.update(trialAnalysisReservations).set({ state: progress.successful > 0 ? "completed" : "released" })
        .where(and(eq(trialAnalysisReservations.id, input.trialReservationId), eq(trialAnalysisReservations.state, "pending"))).returning();
      if (reservation && !progress.successful) await tx.update(trialAnalysisUsage).set({ used: sql`greatest(0, ${trialAnalysisUsage.used} - 1)`, updatedAt: new Date() }).where(eq(trialAnalysisUsage.userId, task.userId));
    }
    const partial = progress.successful > 0 && progress.failed > 0;
    const state = progress.successful > 0 ? "completed" : "failed";
    await tx.update(commercialTasks).set({ state, result: { ...progress, phase: "settle", chargedCredits, partial }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    await tx.update(projects).set({ status: progress.successful > 0 ? "ready" : "failed", metadata: sql`${projects.metadata} || ${JSON.stringify({ failedSceneCount: progress.failed, partialAnalysis: partial, analysisError: progress.error })}::jsonb`, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
    await tx.insert(operationLogs).values({ userId: task.userId, action: progress.successful > 0 ? "analysis.complete" : "analysis.error", resourceType: input.mediaType, resourceId: input.projectId, metadata: { taskId: task.id, billingMode: input.mode, model: input.modelId, provider: "kie", successful: progress.successful, failed: progress.failed, chargedCredits } });
  });
}

export async function runAnalysisTask(id: string) {
  const [task] = await db.update(commercialTasks).set({ state: "running", updatedAt: new Date() }).where(and(eq(commercialTasks.id, id), eq(commercialTasks.kind, "workflow_analysis"), eq(commercialTasks.state, "queued"))).returning();
  if (!task) return;
  const input = task.input as Input;
  let progress = task.result as Progress;
  try {
    const apiKey = await taskKey(input, task.userId);
    if (input.trialReservationId) {
      const [renewed] = await db.update(trialAnalysisReservations).set({ expiresAt: new Date(Date.now() + 30 * 60_000) }).where(and(eq(trialAnalysisReservations.id, input.trialReservationId), eq(trialAnalysisReservations.state, "pending"))).returning();
      if (!renewed) throw new Error("试用任务已过期，请重新创建项目分析。");
    }
    if (progress.phase === "prepare") {
      if (input.mediaType === "image") {
        progress = { ...progress, phase: "assets", assets: { metadata: { duration: 0 }, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 0, duration: 0, keyframeUrls: [input.mediaUrl] }] } };
      } else {
        const preview = await commercialMediaRequest<MediaPreview>(input.mediaUrl, { mode: "preview", automaticSplit: input.longVideoAllowed });
        if (!Number.isSafeInteger(preview.durationUs) || preview.durationUs <= 0 || preview.durationUs > 60_000_000 || preview.bytes > 100 * 1024 * 1024 || !preview.scenes?.length || preview.scenes.length > 20) throw new Error("视频须在 60 秒、100MB 和 20 个镜头以内。");
        if (!input.longVideoAllowed && preview.durationUs > 10_750_000) throw new Error("当前账号仅支持 10 秒以内视频，请使用付费拆镜流程。");
        progress = { ...progress, phase: "assets", preview };
      }
      await saveCheckpoint(task, progress);
      return;
    }
    if (progress.phase === "assets") {
      const assets = progress.assets || await commercialMediaRequest<FfmpegBreakdownResult>(input.mediaUrl, { mode: "assets", sourceHash: progress.preview!.sourceHash, scenes: progress.preview!.scenes });
      if (!assets.scenes.length || assets.scenes.length > 20) throw new Error("INVALID_SCENE_ASSETS");
      if (progress.preview && (assets.scenes.length !== progress.preview.scenes.length || assets.scenes.some((scene, index) => Math.abs(scene.startTime * 1_000_000 - progress.preview!.scenes[index].startUs) > 1000 || Math.abs(scene.endTime * 1_000_000 - progress.preview!.scenes[index].endUs) > 1000))) throw new Error("SPLIT_ASSET_MISMATCH");
      const heldCredits = input.mode === "platform_credits" ? getVideoAnalysisChargeUnits({ sceneCount: assets.scenes.length, longVideo: (progress.preview?.durationUs || 0) > 10_750_000 }) : 0;
      await db.transaction(async (tx) => {
        if (heldCredits) {
          const [wallet] = await tx.update(userCredits).set({ balance: sql`${userCredits.balance} - ${heldCredits}`, lifetimeUsed: sql`${userCredits.lifetimeUsed} + ${heldCredits}`, updatedAt: new Date() }).where(and(eq(userCredits.userId, task.userId), sql`${userCredits.balance} >= ${heldCredits}`)).returning();
          if (!wallet) throw new InsufficientCreditsError(heldCredits, 0);
          await tx.insert(creditLedger).values({ userId: task.userId, type: "feature_usage", amount: -heldCredits, balanceAfter: wallet.balance, note: "预留视频分析积分", metadata: { taskId: task.id, reserved: true } });
        }
        const [reference] = await tx.insert(referenceVideos).values({ projectId: input.projectId, sourceUrl: input.mediaUrl, fileName: input.mediaName, duration: Math.round((progress.preview?.durationUs || 0) / 1_000_000), metadata: assets.metadata }).returning();
        const [version] = await tx.insert(projectVersions).values({ projectId: input.projectId, versionNumber: 0, kind: "original", label: input.outputLanguage === "zh" ? "原始版本" : "Original", overview: { sceneCount: assets.scenes.length } }).returning();
        const sceneIds: string[] = [];
        for (const scene of assets.scenes) {
          const [row] = await tx.insert(videoScenes).values({ projectId: input.projectId, referenceVideoId: reference.id, ...scene, status: "queued" }).returning();
          sceneIds.push(row.id);
        }
        progress = { ...progress, assets, versionId: version.id, sceneIds, heldCredits, phase: input.mediaType === "image" || input.mode === "trial" ? "scenes" : "transcription" };
        await tx.update(projects).set({ activeVersionId: version.id, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
        await tx.update(commercialTasks).set({ state: "queued", result: progress, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
      });
      return;
    }
    if (progress.phase === "transcription") {
      try { progress.transcription = await transcribeMediaWithKie({ userId: task.userId, apiKey, mediaUrl: input.mediaUrl, timeoutMs: 180000 }); }
      catch (error) { progress.transcriptionError = error instanceof Error ? error.message : "Transcription failed"; }
      await saveCheckpoint(task, { ...progress, phase: "music" });
      return;
    }
    if (progress.phase === "music") {
        progress.music = await recognizeBackgroundMusic(progress.assets?.metadata.audioPreviewUrl || input.mediaUrl);
      await saveCheckpoint(task, { ...progress, phase: "scenes" });
      return;
    }
    if (progress.phase === "scenes" && progress.cursor < progress.assets!.scenes.length) {
      const scene = progress.assets!.scenes[progress.cursor];
      const audio = buildSceneAudioContexts({ scenes: progress.assets!.scenes, transcription: progress.transcription || null, unavailableReason: progress.transcriptionError }).get(scene.sceneIndex);
      let blueprint: SceneBlueprintDraft;
      try {
        blueprint = await (input.mediaType === "image" ? analyzeImageBlueprint : analyzeSceneBlueprint)({ userId: task.userId, scene, context: { sceneCount: progress.assets!.scenes.length, audio }, modelMode: "manual", modelId: input.modelId, outputLanguage: input.outputLanguage, analysisApiKey: apiKey, analysisKeySource: input.keySource, allowPlatformKeyForAnalysis: input.keySource === "platform", forceFreeTrialKie: input.mode === "trial" });
      } catch (error) { blueprint = buildFallbackSceneBlueprint(scene, error instanceof Error ? error.message : "Analysis failed"); }
      blueprint = attachBackgroundMusicToBlueprint(blueprint, progress.music);
      const succeeded = blueprint.metadata?.analysisProvider === "kie";
      await db.transaction(async (tx) => {
        await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId!, originalSceneId: progress.sceneIds![progress.cursor], sceneIndex: scene.sceneIndex, duration: scene.duration, ...blueprint });
        await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : String(blueprint.metadata?.fallbackReason || "Analysis failed"), updatedAt: new Date() }).where(eq(videoScenes.id, progress.sceneIds![progress.cursor]));
        progress = { ...progress, cursor: progress.cursor + 1, successful: progress.successful + Number(succeeded), failed: progress.failed + Number(!succeeded) };
        await tx.update(commercialTasks).set({ state: "queued", result: progress, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
      });
      return;
    }
    if (progress.versionId) {
      const scenes = await db.query.sceneVersions.findMany({ where: eq(sceneVersions.projectVersionId, progress.versionId), orderBy: [asc(sceneVersions.sceneIndex)] });
      const project = await db.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      const successful = scenes.filter(s => (s.metadata as Record<string, unknown>).analysisProvider === "kie");
      if (project && successful.length) await db.update(projects).set({ title: deriveProjectTitle({}, successful as unknown as SceneBlueprintDraft[], project.title) }).where(eq(projects.id, project.id));
      await db.update(projectVersions).set({ overview: { sceneCount: scenes.length, successfulSceneCount: progress.successful, failedSceneCount: progress.failed, backgroundMusic: progress.music, narrative: scenes.filter(s => (s.metadata as Record<string, unknown>).analysisProvider === "kie").map(s => (s.story as Record<string, unknown>).summary).filter(Boolean).join("\n") }, updatedAt: new Date() }).where(eq(projectVersions.id, progress.versionId));
    }
    await settleAnalysisTask(task, progress);
  } catch (error) {
    // Read the last committed checkpoint: a failed DB transaction may have rolled back a hold.
    const current = await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, id) });
    await settleAnalysisTask(task, { ...current!.result as Progress, error: error instanceof Error ? error.message : "Analysis failed" });
  }
}

export async function recoverAnalysisTasks() {
  const abandoned = await db.select().from(commercialTasks).where(and(eq(commercialTasks.kind, "workflow_analysis"), eq(commercialTasks.state, "running"), sql`${commercialTasks.updatedAt} < now() - ${LEASE_MS} * interval '1 millisecond'`)).limit(20);
  for (const task of abandoned) {
    // A synchronous KIE call has no queryable task ID; never automatically bill it twice.
    await settleAnalysisTask(task, { ...task.result as Progress, error: "任务执行中断，已保留完成的镜头并退回未交付额度。" });
  }
}
