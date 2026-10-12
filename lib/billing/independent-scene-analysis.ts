import { randomUUID } from "node:crypto";
import { Agent, fetch as directFetch } from "undici";
import { and, asc, eq, sql } from "drizzle-orm";
import { analysisSceneJobs, commercialTasks, db, sceneVersions, videoScenes } from "@/lib/db";
import { analyzeSceneBlueprint, buildFallbackSceneBlueprint, type SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { getPlatformKieApiKey } from "./platform-access";
import { generationKeyFingerprint } from "./generation-key";
import { finishCommercialAnalysis, savedAnalysisModel, type AnalysisInput } from "./commercial-analysis";
import { taskErrorDetails } from "./task-diagnostics";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { releaseAnalysisProviderSlot, reserveAnalysisProviderSlot } from "./analysis-provider-limit";

type Progress = { assets?: FfmpegBreakdownResult; versionId?: string; sceneRecords?: Record<string, string>; splitDelivered?: boolean; sceneJobMode?: string };
const localDispatchAgent = new Agent();

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
    if (jobs.length !== input.pricing.scenes.length || jobs.some(job => !["completed", "failed"].includes(job.state))) return;
    const successes = jobs.filter(job => job.state === "completed").map(job => job.sceneId);
    await finishCommercialAnalysis(task, successes, Boolean((task.result as Progress).splitDelivered), successes.length ? "completed" : "failed", tx, jobs.map(job => job.sceneId));
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
  const asset = progress.assets?.scenes[job.sceneIndex - 1];
  const sceneRecord = progress.sceneRecords?.[job.sceneId];
  if (!asset || !progress.versionId || !sceneRecord) { await quarantineInvalidCheckpoint(task.id, job.id, executionId); return false; }
  let blueprint: SceneBlueprintDraft;
  let requestStarted = false;
  try {
    const apiKey = input.pricing.payer === "platform" ? getPlatformKieApiKey() : await getUserKieApiKey(task.userId);
    if (!apiKey || generationKeyFingerprint(apiKey) !== input.keyFingerprint) throw new Error("KIE_KEY_CHANGED");
    requestStarted = true;
    blueprint = await analyzeSceneBlueprint({ userId: task.userId, scene: asset, context: { sceneCount: input.pricing.scenes.length }, modelMode: "manual", modelId: savedAnalysisModel(input), outputLanguage: input.outputLanguage, analysisApiKey: apiKey, allowPlatformKeyForAnalysis: input.pricing.payer === "platform", analysisKeySource: input.pricing.payer === "platform" ? "platform" : "user", forceFreeTrialKie: false });
  } catch (error) {
    console.error("commercial.scene.model_failed", { taskId: task.id, sceneId: job.sceneId, error: taskErrorDetails(error) });
    const fallback = buildFallbackSceneBlueprint(asset, "Analysis unavailable", undefined, input.outputLanguage);
    blueprint = { ...fallback, metadata: { ...fallback.metadata, providerOutcome: requestStarted ? "unknown" : "not_sent" } };
  }
  if (blueprint.metadata?.providerOutcome !== "unknown") {
    try { await releaseAnalysisProviderSlot(job.id); }
    catch (error) { console.error("commercial.scene.provider_slot_release_failed", { sceneJobId: job.id, error }); }
  }
  const succeeded = blueprint.metadata?.analysisProvider === "kie";
  const [checkpointed] = await db.update(analysisSceneJobs).set({ result: { pendingBlueprint: blueprint }, updatedAt: new Date() })
    .where(and(eq(analysisSceneJobs.id, job.id), eq(analysisSceneJobs.state, "running"), eq(analysisSceneJobs.executionId, executionId))).returning({ id: analysisSceneJobs.id });
  if (!checkpointed) return true;
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(analysisSceneJobs).where(and(eq(analysisSceneJobs.id, job.id), eq(analysisSceneJobs.state, "running"), eq(analysisSceneJobs.executionId, executionId))).for("update");
    if (!current) return; // A recovery worker already fenced this response.
    const [parent] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "running"))).for("update");
    if (!parent || (parent.result as Progress).sceneJobMode !== "independent_v1") return;
    const interval = input.pricing.scenes[job.sceneIndex - 1];
    await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId!, originalSceneId: sceneRecord, sceneIndex: job.sceneIndex, duration: (interval.endUs - interval.startUs) / 1_000_000, ...blueprint });
    await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : String(blueprint.metadata?.fallbackReason || "Analysis unavailable"), updatedAt: new Date() }).where(eq(videoScenes.id, sceneRecord));
    await tx.update(analysisSceneJobs).set({ state: succeeded ? "completed" : "failed", result: { providerOutcome: blueprint.metadata?.providerOutcome || (succeeded ? "success" : "unknown"), analysisProvider: blueprint.metadata?.analysisProvider || "fallback" }, updatedAt: new Date() }).where(eq(analysisSceneJobs.id, job.id));
    const parentResult = parent.result as Record<string, unknown>;
    const finished = Array.isArray(parentResult.finishedSceneIds) ? parentResult.finishedSceneIds as string[] : [];
    const successes = Array.isArray(parentResult.successfulSceneIds) ? parentResult.successfulSceneIds as string[] : [];
    await tx.update(commercialTasks).set({ result: { ...parentResult, finishedSceneIds: [...finished, job.sceneId], successfulSceneIds: succeeded ? [...successes, job.sceneId] : successes }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
  });
  await settleIfTerminal(task.id);
  await dispatchQueuedSceneJobs(task.id);
  return true;
}

export async function recoverStaleAnalysisSceneJobs(limit = 5) {
  const stale = await db.select({ id: analysisSceneJobs.id, taskId: analysisSceneJobs.taskId }).from(analysisSceneJobs)
    .where(and(eq(analysisSceneJobs.state, "running"), sql`${analysisSceneJobs.updatedAt} < now() - interval '6 minutes'`)).orderBy(asc(analysisSceneJobs.updatedAt)).limit(limit);
  for (const job of stale) {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(analysisSceneJobs).where(and(eq(analysisSceneJobs.id, job.id), eq(analysisSceneJobs.state, "running"), sql`${analysisSceneJobs.updatedAt} < now() - interval '6 minutes'`)).for("update");
      if (!current) return;
      const [task] = await tx.select().from(commercialTasks).where(eq(commercialTasks.id, job.taskId)).for("update");
      if (!task || task.state !== "running") return;
      const input = task.input as AnalysisInput;
      const progress = task.result as Progress;
      const asset = progress.assets?.scenes[current.sceneIndex - 1];
      const sceneRecord = progress.sceneRecords?.[current.sceneId];
      if (!asset || !sceneRecord || !progress.versionId) {
        const at = new Date();
        const review = { reason: "checkpoint_invalid", enteredAt: at.toISOString(), nextActionAt: at.toISOString(), deadlineAt: new Date(at.getTime() + 24 * 60 * 60_000).toISOString(), action: "manual_reconciliation" };
        await tx.update(analysisSceneJobs).set({ state: "failed", result: { failureCode: "ANALYSIS_SCENE_CHECKPOINT_MISSING" }, updatedAt: at }).where(eq(analysisSceneJobs.id, current.id));
        await tx.update(commercialTasks).set({ state: "review", result: sql`${commercialTasks.result} || ${JSON.stringify({ review, code: "TASK_REQUIRES_RECONCILIATION" })}::jsonb`, updatedAt: at }).where(eq(commercialTasks.id, task.id));
        return;
      }
      const interval = input.pricing.scenes[current.sceneIndex - 1];
      const pending = (current.result as { pendingBlueprint?: SceneBlueprintDraft }).pendingBlueprint;
      const blueprint = pending || buildFallbackSceneBlueprint(asset, "Analysis interrupted", undefined, input.outputLanguage);
      const succeeded = blueprint.metadata?.analysisProvider === "kie";
      await tx.insert(sceneVersions).values({ projectId: input.projectId, projectVersionId: progress.versionId, originalSceneId: sceneRecord, sceneIndex: current.sceneIndex, duration: (interval.endUs - interval.startUs) / 1_000_000, ...blueprint, metadata: pending ? blueprint.metadata : { ...blueprint.metadata, providerOutcome: "unknown", failureCode: "ANALYSIS_INTERRUPTED", executionId: current.executionId } });
      await tx.update(videoScenes).set({ status: succeeded ? "completed" : "failed", error: succeeded ? null : String(blueprint.metadata?.fallbackReason || "Analysis interrupted"), updatedAt: new Date() }).where(eq(videoScenes.id, sceneRecord));
      await tx.update(analysisSceneJobs).set({ state: succeeded ? "completed" : "failed", result: { providerOutcome: pending ? (succeeded ? "success" : "unknown") : "unknown", failureCode: pending ? null : "ANALYSIS_INTERRUPTED" }, updatedAt: new Date() }).where(eq(analysisSceneJobs.id, current.id));
      const parentResult = task.result as Record<string, unknown>;
      const finished = Array.isArray(parentResult.finishedSceneIds) ? parentResult.finishedSceneIds as string[] : [];
      const successes = Array.isArray(parentResult.successfulSceneIds) ? parentResult.successfulSceneIds as string[] : [];
      await tx.update(commercialTasks).set({ result: { ...parentResult, finishedSceneIds: [...finished, current.sceneId], successfulSceneIds: succeeded ? [...successes, current.sceneId] : successes }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    });
    await settleIfTerminal(job.taskId);
    await dispatchQueuedSceneJobs(job.taskId);
  }
  return stale.length;
}

export async function dispatchQueuedSceneJobs(taskId?: string) {
  const queued = await db.select({ id: analysisSceneJobs.id, taskId: analysisSceneJobs.taskId,
    activeCount: sql<number>`(SELECT count(*)::int FROM analysis_scene_jobs active WHERE active.task_id = ${analysisSceneJobs.taskId} AND active.state = 'running')` }).from(analysisSceneJobs)
    .innerJoin(commercialTasks, eq(commercialTasks.id, analysisSceneJobs.taskId))
    .where(and(eq(analysisSceneJobs.state, "queued"), eq(commercialTasks.state, "running"), taskId ? eq(analysisSceneJobs.taskId, taskId) : undefined,
      sql`(SELECT count(*) FROM analysis_scene_jobs active WHERE active.task_id = ${analysisSceneJobs.taskId} AND active.state = 'running') < 2`))
    .orderBy(asc(analysisSceneJobs.createdAt), asc(analysisSceneJobs.sceneIndex)).limit(taskId ? 2 : 50);
  const secret = process.env.CRON_SECRET;
  const raw = process.env.NODE_ENV === "production" ? process.env.COMMERCIAL_RECONCILIATION_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") : process.env.LOCAL_ANALYSIS_BASE_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
  if (!secret || !raw) return 0;
  let base: URL;
  try { base = new URL(raw); if (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(base.hostname))) return 0; }
  catch { return 0; }
  let sent = 0;
  const dispatchedParents = new Map<string, number>();
  for (const job of queued) {
    const dispatchedForParent = dispatchedParents.get(job.taskId) || 0;
    if (job.activeCount + dispatchedForParent >= 2 || sent >= 5) continue;
    dispatchedParents.set(job.taskId, dispatchedForParent + 1);
    try {
      const url = new URL("/api/internal/analysis-run", base);
      const request = { method: "POST", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ sceneJobId: job.id }) };
      const response = base.protocol === "http:"
        ? await directFetch(url, { ...request, dispatcher: localDispatchAgent })
        : await fetch(url, { ...request, cache: "no-store" });
      if (response.ok) sent++;
    } catch (error) { console.error("commercial.scene.dispatch_failed", { sceneJobId: job.id, error }); }
  }
  return sent;
}
