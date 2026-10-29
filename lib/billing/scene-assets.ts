import { and, eq, sql } from "drizzle-orm";
import { analysisSceneJobs, commercialTasks, db, projectAssets, videoScenes } from "@/lib/db";
import { commercialMediaRequest, type MediaPreview } from "./commercial-media";
import type { AnalysisInput } from "./commercial-analysis";
import type { FfmpegBreakdownResult, FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";

type Task = typeof commercialTasks.$inferSelect;
type Job = typeof analysisSceneJobs.$inferSelect;
type Progress = { assets: FfmpegBreakdownResult; sceneRecords: Record<string, string> };

// Cache entries are trusted only through their owner's server-detected snapshot,
// matching source hash AND exact interval. Never mix frames from different shots.
async function cachedPreviewAsset(task: Task, job: Job, input: AnalysisInput) {
  const files = await db.select({ file: projectAssets, source: commercialTasks.input }).from(projectAssets)
    .innerJoin(commercialTasks, sql`${commercialTasks.id}::text = ${projectAssets.metadata}->>'downloadPreparationId'`)
    .where(and(eq(projectAssets.projectId, input.projectId), eq(commercialTasks.userId, task.userId), eq(commercialTasks.kind, "analysis_preview"),
      sql`${commercialTasks.input}->>'projectId' = ${input.projectId}`,
      sql`${commercialTasks.input}->>'mediaUrl' = ${input.mediaUrl}`,
      sql`${commercialTasks.input}->'preview'->>'sourceHash' = ${input.preview.sourceHash}`));
  const interval = input.pricing.scenes[job.sceneIndex - 1];
  const groups = new Map<string, typeof files>();
  for (const entry of files) {
    const metadata = entry.file.metadata as { downloadPreparationId?: string; sceneId?: string };
    const source = entry.source as { preview: MediaPreview; retentionExpired?: boolean };
    if (source.retentionExpired || !source.preview?.scenes?.some(s => s.id === metadata.sceneId && s.startUs === interval.startUs && s.endUs === interval.endUs)) continue;
    const key = `${metadata.downloadPreparationId}:${metadata.sceneId}`;
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  for (const group of groups.values()) {
    const clipUrl = group.find(x => x.file.type === "scene_clip")?.file.url;
    const keyframeUrls = [...new Set(group.filter(x => x.file.type === "keyframe").map(x => x.file.url))].sort();
    if (clipUrl && keyframeUrls.length >= 3) return { clipUrl, keyframeUrls: keyframeUrls.slice(0, 3), audioUrl: group.find(x => x.file.type === "audio")?.file.url };
  }
  return null;
}

export async function prepareIndependentSceneAsset(task: Task, job: Job, executionId: string): Promise<FfmpegSceneAsset> {
  const input = task.input as AnalysisInput;
  const progress = task.result as Progress;
  const existing = progress.assets?.scenes[job.sceneIndex - 1];
  if (existing?.keyframeUrls?.length) return existing;
  const interval = input.pricing.scenes[job.sceneIndex - 1];
  if (!interval || !existing) throw new Error("ANALYSIS_SCENE_CHECKPOINT_MISSING");
  const startedAt = Date.now();
  const cached = await cachedPreviewAsset(task, job, input);
  let result: FfmpegSceneAsset;
  if (cached) result = { ...existing, ...cached };
  else {
    const assets = await commercialMediaRequest<FfmpegBreakdownResult>(input.mediaUrl,
      { mode: "assets", sourceHash: input.preview.sourceHash, scenes: [interval] }, { timeoutMs: 60_000 });
    const shot = assets.scenes[0];
    if (assets.scenes.length !== 1 || !shot?.clipUrl || shot.keyframeUrls?.length !== 3
      || Math.abs(shot.startTime * 1e6 - interval.startUs) > 1000 || Math.abs(shot.endTime * 1e6 - interval.endUs) > 1000) throw new Error("SPLIT_ASSET_MISMATCH");
    result = { ...shot, sceneIndex: job.sceneIndex, shotGroupId: interval.id };
  }
  result = { ...result, sceneIndex: job.sceneIndex, shotGroupId: interval.id,
    transitionIn: job.sceneIndex === 1 ? "start" : "hard_cut",
    transitionOut: job.sceneIndex === input.pricing.scenes.length ? "end" : "hard_cut" };
  await db.transaction(async tx => {
    const [current] = await tx.select().from(analysisSceneJobs).where(and(eq(analysisSceneJobs.id, job.id), eq(analysisSceneJobs.state, "running"), eq(analysisSceneJobs.executionId, executionId))).for("update");
    if (!current) throw new Error("ANALYSIS_EXECUTION_LOST");
    const [parent] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "running"))).for("update");
    if (!parent) throw new Error("ANALYSIS_EXECUTION_LOST");
    const latest = parent.result as Progress;
    const scenes = [...latest.assets.scenes];
    scenes[job.sceneIndex - 1] = result;
    await tx.update(videoScenes).set({ clipUrl: result.clipUrl, keyframeUrls: result.keyframeUrls, audioUrl: result.audioUrl, updatedAt: new Date() }).where(eq(videoScenes.id, latest.sceneRecords[job.sceneId]));
    await tx.update(commercialTasks).set({ result: { ...parent.result as object, assets: { ...latest.assets, scenes }, splitDelivered: input.pricing.automaticSplit && scenes.every(s => s.keyframeUrls.length > 0) }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
  });
  console.info("commercial.scene.assets_ready", { taskId: task.id, sceneJobId: job.id, sceneIndex: job.sceneIndex, cacheHit: Boolean(cached), preparationMs: Date.now() - startedAt });
  return result;
}
