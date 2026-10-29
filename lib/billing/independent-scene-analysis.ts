import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { analysisProviderSlots, analysisSceneJobs, commercialTasks, db, sceneVersions, videoScenes } from "@/lib/db";
import { analyzeSceneBlueprint, buildFallbackSceneBlueprint, type SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import { finishCommercialAnalysis, savedAnalysisModel, type AnalysisInput } from "./commercial-analysis";
import { taskErrorDetails } from "./task-diagnostics";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { releaseAnalysisProviderSlot, reserveAnalysisProviderSlot } from "./analysis-provider-limit";
import { analysisDispatchTarget, dispatchAnalysisInvocation } from "@/lib/workflow/analysis-dispatch";
import { hasUsablePrompt } from "@/lib/workflow/scene-analysis-result";
import { prepareIndependentSceneAsset } from "./scene-assets";

type Progress = { assets?: FfmpegBreakdownResult; versionId?: string; sceneRecords?: Record<string, string>; splitDelivered?: boolean; sceneJobMode?: string };

const recoveryDue = sql`(
  (jsonb_typeof(${analysisSceneJobs.result}->'pendingBlueprint') = 'object'
    AND ${analysisSceneJobs.updatedAt} < now() - interval '20 seconds')
  OR ${analysisSceneJobs.updatedAt} < now() - interval '6 minutes'
)`;

// Retry only the fenced database operation, never the model request.
function retryableSaveError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const value = error as { code?: string; cause?: unknown };
  return ["40001", "40P01", "55P03", "57014", "08006", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "ECONNRESET"].includes(value.code || "")
    || retryableSaveError(value.cause, depth + 1);
}

function traceSceneSave(sceneJobId: string, attempt: number, recovery: boolean, initialStage = "acquire_connection") {
  const startedAt = Date.now();
  let stage = initialStage;
  let stageStartedAt = startedAt;
  const durations: Record<string, number> = {};
  const timer = setTimeout(() => console.warn("commercial.scene.save_slow", {
    sceneJobId, attempt, recovery, stage, elapsedMs: Date.now() - startedAt,
  }), 5_000);
  timer.unref();
  return {
    mark(next: string) {
      durations[stage] = (durations[stage] || 0) + Date.now() - stageStartedAt;
      stage = next;
      stageStartedAt = Date.now();
    },
    snapshot: () => ({ stage, elapsedMs: Date.now() - startedAt, stagesMs: { ...durations, [stage]: (durations[stage] || 0) + Date.now() - stageStartedAt } }),
    stop: () => clearTimeout(timer),
  };
}

async function saveSceneCheckpoint(jobId: string, executionId?: string, deliveryFlush = false) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const trace = traceSceneSave(jobId, attempt, !executionId);
    try {
      const saved = await db.transaction(async tx => {
        trace.mark("configure_transaction");
        await tx.execute(sql`SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '15s', true), set_config('idle_in_transaction_session_timeout', '20s', true)`);
        trace.mark("lock_scene_job");
        const [current] = await tx.select().from(analysisSceneJobs).where(and(
          eq(analysisSceneJobs.id, jobId), eq(analysisSceneJobs.state, "running"),
          executionId ? eq(analysisSceneJobs.executionId, executionId) : deliveryFlush ? sql`jsonb_typeof(${analysisSceneJobs.result}->'pendingBlueprint') = 'object'` : recoveryDue,
        )).for("update", executionId ? undefined : { skipLocked: true });
        if (!current) return null;
        trace.mark("lock_parent_task");
        const [task] = await tx.select().from(commercialTasks).where(eq(commercialTasks.id, current.taskId)).for("update", deliveryFlush ? { skipLocked: true } : undefined);
        if (!task || task.state !== "running" || (task.result as Progress).sceneJobMode !== "independent_v1") return null;
        const input = task.input as AnalysisInput;
        const progress = task.result as Progress;
        const asset = progress.assets?.scenes[current.sceneIndex - 1];
        const sceneRecord = progress.sceneRecords?.[current.sceneId];
        if (!asset || !sceneRecord || !progress.versionId) {
          const at = new Date();
          const review = { reason: "checkpoint_invalid", enteredAt: at.toISOString(), nextActionAt: at.toISOString(), deadlineAt: new Date(at.getTime() + 24 * 60 * 60_000).toISOString(), action: "manual_reconciliation" };
          await tx.update(analysisSceneJobs).set({ state: "failed", result: { failureCode: "ANALYSIS_SCENE_CHECKPOINT_MISSING" }, updatedAt: at }).where(eq(analysisSceneJobs.id, current.id));
          await tx.update(commercialTasks).set({ state: "review", result: sql`${commercialTasks.result} || ${JSON.stringify({ review, code: "TASK_REQUIRES_RECONCILIATION" })}::jsonb`, updatedAt: at }).where(eq(commercialTasks.id, task.id));
          return task.id;
        }
        const stored = current.result as { pendingBlueprint?: SceneBlueprintDraft; timings?: Record<string, unknown> };
        // A live worker must already have persisted its answer. Only stale recovery can mark an interrupted inference failed.
        if (executionId && !stored.pendingBlueprint) return null;
        const pending = stored.pendingBlueprint;
        let blueprint = pending || buildFallbackSceneBlueprint(asset, "Analysis interrupted", undefined, input.outputLanguage);
        // A provider label alone cannot make an empty checkpoint billable. Recovery
        // only saves the checkpoint; it must never resubmit inference here.
        if (blueprint.metadata?.analysisProvider === "kie" && !hasUsablePrompt(blueprint.generationPrompt)) {
          const failure = buildFallbackSceneBlueprint(asset, "Analysis returned no usable generation prompt", undefined, input.outputLanguage);
          blueprint = { ...failure, metadata: { ...failure.metadata, analysisResultAttempts: blueprint.metadata.analysisResultAttempts, providerAttemptUnconfirmed: blueprint.metadata.providerAttemptUnconfirmed, providerOutcome: blueprint.metadata.providerAttemptUnconfirmed ? "unknown" : "confirmed_failure", failureCode: "KIE_INVALID_RESULT" } };
        }
        const succeeded = blueprint.metadata?.analysisProvider === "kie";
        const interval = input.pricing.scenes[current.sceneIndex - 1];
        trace.mark("insert_scene_result");
        const retryVersion = input.retry?.sceneVersions.find(scene => scene.id === current.sceneId);
        const metadata = pending ? blueprint.metadata : { ...blueprint.metadata, providerOutcome: "unknown", failureCode: "ANALYSIS_INTERRUPTED", executionId: current.executionId };
        if (input.retry) {
          if (!retryVersion) throw new Error("ANALYSIS_CHECKPOINT_MISMATCH");
          const [updated] = await tx.update(sceneVersions).set({ ...blueprint, metadata: { ...metadata, retryOfSceneVersionId: retryVersion.sceneVersionId }, updatedAt: new Date() }).where(and(eq(sceneVersions.id, retryVersion.sceneVersionId), eq(sceneVersions.projectId, input.projectId), eq(sceneVersions.originalSceneId, sceneRecord))).returning({ id: sceneVersions.id });
          if (!updated) throw new Error("ANALYSIS_CHECKPOINT_MISSING");
        } else {
          await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId, originalSceneId: sceneRecord, sceneIndex: current.sceneIndex, duration: (interval.endUs - interval.startUs) / 1_000_000, ...blueprint, metadata });
        }
        trace.mark("update_scene_status");
        await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : String(blueprint.metadata?.fallbackReason || "Analysis interrupted"), updatedAt: new Date() }).where(eq(videoScenes.id, sceneRecord));
        trace.mark("complete_scene_job");
        const timings = { ...stored.timings, savedAt: new Date().toISOString(), checkpointToSaveMs: Math.max(0, Date.now() - current.updatedAt.getTime()), recovered: !executionId && !deliveryFlush, deliveryFlush, saveAttempt: attempt, saveStagesMs: trace.snapshot().stagesMs };
        const providerOutcome = pending ? blueprint.metadata?.providerOutcome || (succeeded ? "success" : "unknown") : "unknown";
        await tx.update(analysisSceneJobs).set({ state: succeeded ? "completed" : "failed", result: { providerOutcome, providerAttemptUnconfirmed: blueprint.metadata?.providerAttemptUnconfirmed, analysisProvider: blueprint.metadata?.analysisProvider || "fallback", failureCode: pending ? blueprint.metadata?.failureCode ?? null : "ANALYSIS_INTERRUPTED", analysisResultAttempts: blueprint.metadata?.analysisResultAttempts, timings }, updatedAt: new Date() }).where(eq(analysisSceneJobs.id, current.id));
        const parentResult = task.result as Record<string, unknown>;
        const finished = Array.isArray(parentResult.finishedSceneIds) ? parentResult.finishedSceneIds as string[] : [];
        const successes = Array.isArray(parentResult.successfulSceneIds) ? parentResult.successfulSceneIds as string[] : [];
        trace.mark("update_parent_progress");
        const parentUpdate = tx.update(commercialTasks).set({ result: { ...parentResult, finishedSceneIds: [...new Set([...finished, current.sceneId])], successfulSceneIds: succeeded ? [...new Set([...successes, current.sceneId])] : successes }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id)).returning({ id: commercialTasks.id });
        // A successful replacement does not prove the first request stopped.
        const knownOutcome = providerOutcome !== "unknown" && !blueprint.metadata?.providerAttemptUnconfirmed;
        const releaseSlot = tx.update(analysisProviderSlots).set({ releasedAt: new Date() }).where(and(eq(analysisProviderSlots.sceneJobId, current.id), sql`${knownOutcome}`, sql`${analysisProviderSlots.releasedAt} IS NULL`)).returning({ id: analysisProviderSlots.sceneJobId });
        // Publish the result and free a known provider slot together, with one database round trip.
        await tx.execute(sql`WITH parent_progress AS (${parentUpdate.getSQL()}), released_provider AS (${releaseSlot.getSQL()}) SELECT id FROM parent_progress`);
        trace.mark("commit_transaction");
        return task.id;
      });
      console.info("commercial.scene.save_transaction_finished", { sceneJobId: jobId, attempt, recovery: !executionId, saved: Boolean(saved), ...trace.snapshot() });
      return saved;
    } catch (error) {
      console.error("commercial.scene.save_failed", { sceneJobId: jobId, attempt, recovery: !executionId, ...trace.snapshot(), error: taskErrorDetails(error) });
      if (attempt === 2 || !retryableSaveError(error)) throw error;
    } finally {
      trace.stop();
    }
  }
  return null;
}

async function quarantineInvalidCheckpoint(taskId: string, sceneJobId: string, executionId: string) {
  const at = new Date();
  const review = { reason: "checkpoint_invalid", enteredAt: at.toISOString(), nextActionAt: at.toISOString(), deadlineAt: new Date(at.getTime() + 24 * 60 * 60_000).toISOString(), action: "manual_reconciliation" };
  await db.transaction(async (tx) => {
    const [current] = await tx.update(analysisSceneJobs).set({ state: "failed", result: { failureCode: "ANALYSIS_SCENE_CHECKPOINT_MISSING" }, updatedAt: at }).where(and(eq(analysisSceneJobs.id, sceneJobId), eq(analysisSceneJobs.state, "running"), eq(analysisSceneJobs.executionId, executionId))).returning({ id: analysisSceneJobs.id });
    if (!current) return;
    await tx.update(commercialTasks).set({ state: "review", result: sql`${commercialTasks.result} || ${JSON.stringify({ review, code: "TASK_REQUIRES_RECONCILIATION" })}::jsonb`, updatedAt: at }).where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.state, "running")));
  });
}

async function settleIfTerminal(taskId: string) {
  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.state, "running"))).for("update");
    if (!task || (task.result as Progress).sceneJobMode !== "independent_v1") return;
    const jobs = await tx.select().from(analysisSceneJobs).where(eq(analysisSceneJobs.taskId, taskId)).orderBy(asc(analysisSceneJobs.sceneIndex));
    const input = task.input as AnalysisInput;
    if (jobs.length !== (input.retry?.sceneVersions.length ?? input.pricing.scenes.length) || jobs.some(job => !["completed", "failed"].includes(job.state))) return;
    const successes = [...new Set([...(input.retry?.previousSuccess || []), ...jobs.filter(job => job.state === "completed").map(job => job.sceneId)])];
    await finishCommercialAnalysis(task, successes, Boolean((task.result as Progress).splitDelivered), successes.length > (input.retry?.previousSuccess.length || 0) ? "completed" : "failed", tx, jobs.map(job => job.sceneId));
  });
}

export async function reconcileTerminalIndependentAnalysis(taskId?: string, limit = 5) {
  const terminal = await db.select({ id: commercialTasks.id }).from(commercialTasks)
    .where(and(eq(commercialTasks.state, "running"), sql`${commercialTasks.result}->>'sceneJobMode' = 'independent_v1'`,
      taskId ? eq(commercialTasks.id, taskId) : undefined,
      sql`EXISTS (SELECT 1 FROM analysis_scene_jobs job WHERE job.task_id = ${commercialTasks.id})`,
      sql`NOT EXISTS (SELECT 1 FROM analysis_scene_jobs job WHERE job.task_id = ${commercialTasks.id} AND job.state IN ('queued', 'running'))`))
    .orderBy(asc(commercialTasks.updatedAt)).limit(limit);
  for (const task of terminal) await settleIfTerminal(task.id);
  return terminal.length;
}

export async function runIndependentSceneJob(jobId: string) {
  const startedAt = Date.now();
  const executionId = randomUUID();
  const claimed = await db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(analysisSceneJobs).where(and(eq(analysisSceneJobs.id, jobId), eq(analysisSceneJobs.state, "queued"))).for("update");
    if (!candidate) return null;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate.taskId}))`);
    const [task] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, candidate.taskId), eq(commercialTasks.state, "running"))).for("update");
    if (!task || (task.result as Progress).sceneJobMode !== "independent_v1") return null;
    const [active] = await tx.select({ count: sql<number>`count(*)::int` }).from(analysisSceneJobs).where(and(eq(analysisSceneJobs.taskId, task.id), eq(analysisSceneJobs.state, "running")));
    if (active.count >= 2) return null;
    if (!await reserveAnalysisProviderSlot(tx, candidate.id, (task.input as AnalysisInput).keyFingerprint)) return null;
    const [job] = await tx.update(analysisSceneJobs).set({ state: "running", executionId, updatedAt: new Date() }).where(and(eq(analysisSceneJobs.id, jobId), eq(analysisSceneJobs.state, "queued"))).returning();
    return job ? { job, task } : null;
  });
  if (!claimed) return false;
  const { job, task } = claimed;
  const input = task.input as AnalysisInput;
  const progress = task.result as Progress;
  let asset = progress.assets?.scenes[job.sceneIndex - 1];
  const sceneRecord = progress.sceneRecords?.[job.sceneId];
  if (!asset || !progress.versionId || !sceneRecord) { await quarantineInvalidCheckpoint(task.id, job.id, executionId); return false; }
  let modelStartedAt = Date.now();
  let preparationMs = 0;
  let blueprint: SceneBlueprintDraft;
  let requestStarted = false;
  try {
    const apiKey = input.pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(task.userId);
    if (!apiKey || generationKeyFingerprint(apiKey) !== input.keyFingerprint) throw new Error("KIE_KEY_CHANGED");
    if (input.executionMode === "scene_pipeline_v1") {
      const preparingAt = Date.now();
      asset = await prepareIndependentSceneAsset(task, job, executionId);
      preparationMs = Date.now() - preparingAt;
    }
    modelStartedAt = Date.now();
    console.info("commercial.scene.model_started", { taskId: task.id, sceneJobId: job.id, sceneIndex: job.sceneIndex, preparationMs, queueMs: modelStartedAt - job.createdAt.getTime() });
    requestStarted = true;
    blueprint = await analyzeSceneBlueprint({ userId: task.userId, scene: asset, context: { sceneCount: input.pricing.scenes.length }, modelMode: "manual", modelId: savedAnalysisModel(input), outputLanguage: input.outputLanguage, analysisApiKey: apiKey, analysisBudgetMs: Math.max(1, startedAt + 270_000 - Date.now()), allowPlatformKeyForAnalysis: input.pricing.payer === "platform", analysisKeySource: input.pricing.payer === "platform" ? "platform" : "user", forceFreeTrialKie: false });
  } catch (error) {
    console.error("commercial.scene.model_failed", { taskId: task.id, sceneId: job.sceneId, error: taskErrorDetails(error) });
    const fallback = buildFallbackSceneBlueprint(asset, "Analysis unavailable", undefined, input.outputLanguage);
    blueprint = { ...fallback, metadata: { ...fallback.metadata, providerOutcome: requestStarted ? "unknown" : "not_sent" } };
  }
  const modelFinishedAt = Date.now();
  const timings = { startedAt: new Date(startedAt).toISOString(), modelFinishedAt: new Date(modelFinishedAt).toISOString(), preparationMs, queueMs: startedAt - job.createdAt.getTime(), modelMs: requestStarted ? modelFinishedAt - modelStartedAt : 0 };
  console.info("commercial.scene.model_finished", { taskId: task.id, sceneJobId: job.id, sceneIndex: job.sceneIndex, ...timings });
  // Persist the response before any optional cleanup so a cleanup failure cannot lose it.
  const checkpointTrace = traceSceneSave(job.id, 1, false, "persist_model_checkpoint");
  let checkpointed: { id: string } | undefined;
  try {
    [checkpointed] = await db.update(analysisSceneJobs).set({ result: { pendingBlueprint: blueprint, timings }, updatedAt: new Date() })
      .where(and(eq(analysisSceneJobs.id, job.id), eq(analysisSceneJobs.state, "running"), eq(analysisSceneJobs.executionId, executionId))).returning({ id: analysisSceneJobs.id });
    console.info("commercial.scene.checkpoint_finished", { sceneJobId: job.id, checkpointed: Boolean(checkpointed), ...checkpointTrace.snapshot() });
  } catch (error) {
    console.error("commercial.scene.checkpoint_failed", { sceneJobId: job.id, ...checkpointTrace.snapshot(), error: taskErrorDetails(error) });
    throw error;
  } finally {
    checkpointTrace.stop();
  }
  let saved = false;
  try {
    if (checkpointed) {
      saved = Boolean(await saveSceneCheckpoint(job.id, executionId));
      console.info("commercial.scene.save_finished", { taskId: task.id, sceneJobId: job.id, saved, saveMs: Date.now() - modelFinishedAt });
    }
  } finally {
    if (!saved && blueprint.metadata?.providerOutcome !== "unknown" && !blueprint.metadata?.providerAttemptUnconfirmed) {
      try { await releaseAnalysisProviderSlot(job.id); }
      catch (error) { console.error("commercial.scene.provider_slot_release_failed", { sceneJobId: job.id, error: taskErrorDetails(error) }); }
    }
    // Start queued work before parent settlement; billing delays must not hold an available lane.
    await dispatchQueuedSceneJobs(task.id);
  }
  await settleIfTerminal(task.id);
  return true;
}

export async function recoverStaleAnalysisSceneJobs(limit = 5, taskId?: string) {
  const stale = await db.select({ id: analysisSceneJobs.id, taskId: analysisSceneJobs.taskId }).from(analysisSceneJobs)
    .where(and(eq(analysisSceneJobs.state, "running"), taskId ? eq(analysisSceneJobs.taskId, taskId) : undefined,
      recoveryDue)).orderBy(asc(analysisSceneJobs.updatedAt)).limit(limit);
  for (const job of stale) {
    try {
      const saved = await saveSceneCheckpoint(job.id);
      if (!saved) continue;
      await dispatchQueuedSceneJobs(job.taskId);
      await settleIfTerminal(job.taskId);
    } catch (error) {
      // One bad checkpoint must not block recovery of the other completed responses.
      console.error("commercial.scene.recovery_failed", { taskId: job.taskId, sceneJobId: job.id, error: taskErrorDetails(error) });
    }
  }
  return stale.length;
}

// Deliver already persisted answers on the next status read, without the 20s
// stale-recovery delay. This never starts inference or claims queued jobs.
export async function flushReadyAnalysisSceneResults(taskId: string) {
  const ready = await db.select({ id: analysisSceneJobs.id }).from(analysisSceneJobs).where(and(
    eq(analysisSceneJobs.taskId, taskId), eq(analysisSceneJobs.state, "running"),
    sql`jsonb_typeof(${analysisSceneJobs.result}->'pendingBlueprint') = 'object'`,
  )).limit(2);
  let saved = 0;
  for (const job of ready) {
    try { if (await saveSceneCheckpoint(job.id, undefined, true)) saved++; }
    catch (error) { console.error("commercial.scene.delivery_flush_failed", { taskId, sceneJobId: job.id, error: taskErrorDetails(error) }); }
  }
  // Settlement/next dispatch belongs to the existing after-response continuation.
  // Rendering a saved answer must not wait for another parent-task transaction.
  return saved;
}

// Task status polling also runs in local development, where Vercel Cron is absent.
// Claim one recovery attempt per task every 15 seconds across concurrent poll requests.
export async function resumeIndependentAnalysis(taskId: string) {
  const [claimed] = await db.update(commercialTasks)
    .set({ result: sql`${commercialTasks.result} || jsonb_build_object('sceneRecoveryAt', now())` })
    .where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.state, "running"),
      sql`${commercialTasks.result}->>'sceneJobMode' = 'independent_v1'`,
      sql`coalesce((${commercialTasks.result}->>'sceneRecoveryAt')::timestamptz, 'epoch'::timestamptz) < now() - interval '15 seconds'`))
    .returning({ id: commercialTasks.id });
  if (!claimed) return false;
  await recoverStaleAnalysisSceneJobs(5, taskId);
  await reconcileTerminalIndependentAnalysis(taskId);
  await dispatchQueuedSceneJobs(taskId);
  return true;
}

export async function resumeLocalIndependentAnalyses() {
  if (process.env.NODE_ENV !== "development") return;
  const userIds = (process.env.LOCAL_ANALYSIS_USER_IDS || "").split(",").map(id => id.trim()).filter(id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id));
  if (!userIds.length) return;
  // Local and production may share a database. Only resume explicitly scoped local tasks.
  const tasks = await db.select({ id: commercialTasks.id }).from(commercialTasks).where(and(
    eq(commercialTasks.state, "running"), eq(commercialTasks.kind, "analysis"), inArray(commercialTasks.userId, userIds),
    sql`${commercialTasks.result}->>'sceneJobMode' = 'independent_v1'`,
  )).orderBy(sql`(${commercialTasks.result}->>'sceneRecoveryAt')::timestamptz ASC NULLS FIRST`, asc(commercialTasks.createdAt)).limit(5);
  for (const task of tasks) {
    try { await resumeIndependentAnalysis(task.id); }
    catch (error) { console.error("commercial.scene.local_resume_failed", { taskId: task.id, error: taskErrorDetails(error) }); }
  }
}

export async function dispatchQueuedSceneJobs(taskId?: string) {
  if (!process.env.CRON_SECRET || !analysisDispatchTarget()) return 0;
  const queued = await db.select({ id: analysisSceneJobs.id, taskId: analysisSceneJobs.taskId,
    activeCount: sql<number>`(SELECT count(*)::int FROM analysis_scene_jobs active WHERE active.task_id = ${analysisSceneJobs.taskId} AND active.state = 'running')` }).from(analysisSceneJobs)
    .innerJoin(commercialTasks, eq(commercialTasks.id, analysisSceneJobs.taskId))
    .where(and(eq(analysisSceneJobs.state, "queued"), eq(commercialTasks.state, "running"), taskId ? eq(analysisSceneJobs.taskId, taskId) : undefined,
      sql`(SELECT count(*) FROM analysis_scene_jobs active WHERE active.task_id = ${analysisSceneJobs.taskId} AND active.state = 'running') < 2`))
    .orderBy(asc(analysisSceneJobs.createdAt), asc(analysisSceneJobs.sceneIndex)).limit(taskId ? 2 : 50);
  const candidates: typeof queued = [];
  const dispatchedParents = new Map<string, number>();
  for (const job of queued) {
    const dispatchedForParent = dispatchedParents.get(job.taskId) || 0;
    if (job.activeCount + dispatchedForParent >= 2 || candidates.length >= 5) continue;
    dispatchedParents.set(job.taskId, dispatchedForParent + 1);
    candidates.push(job);
  }
  // HTTP acknowledgements are independent. One slow request must not hold the other available lanes.
  const dispatched = await Promise.all(candidates.map(job => dispatchAnalysisInvocation({ sceneJobId: job.id })));
  return dispatched.filter(Boolean).length;
}
