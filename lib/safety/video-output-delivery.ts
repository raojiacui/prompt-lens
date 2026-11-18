import { and, eq, sql } from "drizzle-orm";
import { db, videoGeneration, workflowJobs, sceneVersions } from "@/lib/db";
import { moderateVideoOutput, pollVideoOutputModeration, removeStagedModerationVideo, requiresVideoOutputModeration, type OutputVerdict } from "./video-output-moderation";

type VideoRecord = typeof videoGeneration.$inferSelect;
export type VideoDeliveryStatus = { status: "success" | "generating" | "fail" | "review"; videoUrl?: string; error?: string; stage?: "reviewing_output" };
type ProviderStatus = { state: string; videoUrl?: string; error?: string; raw?: unknown };
type Review = { state: "checking" | "approved" | "review" | "blocked" | "unavailable"; startedAt?: number; checkedAt?: number; retryAfter?: number; requestId?: string; provider?: "google_video_intelligence"; operationName?: string; stagedObject?: string; code?: string };

function meta(record: VideoRecord): Record<string, unknown> {
  return record.rawResponse && typeof record.rawResponse === "object" && !Array.isArray(record.rawResponse)
    ? record.rawResponse as Record<string, unknown> : {};
}
function readReview(record: VideoRecord): Review | undefined {
  const x = meta(record).outputReview;
  return x && typeof x === "object" && !Array.isArray(x) ? x as Review : undefined;
}
function safeRaw(record: VideoRecord, review?: Review): Record<string, unknown> {
  const old = meta(record);
  return { ...(old.billing ? { billing: old.billing } : {}), ...(review ? { outputReview: review } : {}) };
}
function inProgress(message = "视频已生成，正在进行输出内容审核。"): VideoDeliveryStatus {
  return { status: "generating", stage: "reviewing_output", error: message };
}
function held(state: "review" | "blocked"): VideoDeliveryStatus {
  return { status: "review", stage: "reviewing_output", error: state === "blocked"
    ? "视频未通过输出安全审核，暂不展示。如需申诉请联系客服。"
    : "视频需要进一步内容审核，暂不展示。" };
}

export function publicVideoRecord(record: VideoRecord): VideoRecord {
  if (!requiresVideoOutputModeration()) return record;
  const review = readReview(record);
  const approved = review?.state === "approved";
  return {
    ...record, videoUrl: approved ? record.videoUrl : null,
    rawResponse: safeRaw(record, review),
    ...(record.status === "completed" && !approved ? { status: "processing" } : {}),
  };
}

/** Single CAS gate for BYOK status routes. Provider completion is NOT content approval. */
export async function reconcileVideoDelivery(record: VideoRecord, status: ProviderStatus): Promise<VideoDeliveryStatus> {
  if (!requiresVideoOutputModeration()) throw Error("Video output gate is test-project-only");
  const review = readReview(record);
  if (review?.state === "approved" && record.videoUrl) return { status: "success", videoUrl: record.videoUrl };
  if (review?.state === "review" || review?.state === "blocked") return held(review.state);
  const now = Date.now();
  // An asynchronous Google operation must be polled, not resubmitted.
  if (review?.state === "checking" && review.operationName) {
    if (status.state !== "success" || !status.videoUrl) return inProgress();
    if ((review.startedAt || 0) < now - 30 * 60_000) {
      const overdue: Review = { ...review, state: "review", checkedAt: now, code: "operation_timeout" };
      await db.update(videoGeneration).set({
        status: "review", videoUrl: null, error: "输出审核时间过长，需要人工复核。",
        rawResponse: safeRaw(record, overdue), updatedAt: new Date(),
      }).where(and(eq(videoGeneration.id, record.id),
        sql`${videoGeneration.rawResponse}->'outputReview'->>'operationName' = ${review.operationName}`,
        sql`${videoGeneration.rawResponse}->'outputReview'->>'state' = 'checking'`));
      return held("review");
    }
    if ((review.retryAfter || 0) > now) return inProgress();
    const polled = await pollVideoOutputModeration(review.operationName);
    const pending = polled.state === "checking" || polled.state === "unavailable";
    const next: Review = {
      ...review,
      state: pending ? "checking" : polled.state,
      checkedAt: now, ...(pending ? { retryAfter: now + 15_000 } : {}),
      ...(polled.code ? { code: polled.code } : {}),
    };
    await db.update(videoGeneration).set({
      status: pending ? "processing" : polled.state === "approved" ? "completed" : "review",
      videoUrl: polled.state === "approved" ? status.videoUrl || null : null,
      error: polled.state === "blocked" ? held("blocked").error :
        polled.state === "review" ? held("review").error : null,
      rawResponse: safeRaw(record, next), updatedAt: new Date(),
    }).where(and(eq(videoGeneration.id, record.id),
      sql`${videoGeneration.rawResponse}->'outputReview'->>'operationName' = ${review.operationName}`,
      sql`${videoGeneration.rawResponse}->'outputReview'->>'state' = 'checking'`));
    if (!pending && review.stagedObject) await removeStagedModerationVideo(review.stagedObject);
    if (polled.state === "approved" && status.videoUrl) {
      if (record.projectId) await db.update(workflowJobs).set({
        status: "completed", resultUrl: status.videoUrl,
        output: { providerTaskId: record.taskId, videoUrl: status.videoUrl, outputReview: next },
        completedAt: new Date(), updatedAt: new Date(),
      }).where(and(eq(workflowJobs.externalTaskId, record.taskId), eq(workflowJobs.projectId, record.projectId)));
      if (record.sceneId && record.projectVersionId) await db.update(sceneVersions).set({
        generatedVideoUrl: status.videoUrl, updatedAt: new Date(),
      }).where(and(eq(sceneVersions.originalSceneId, record.sceneId), eq(sceneVersions.projectVersionId, record.projectVersionId)));
      return { status: "success", videoUrl: status.videoUrl };
    }
    if (polled.state === "blocked" || polled.state === "review") return held(polled.state);
    return inProgress();
  }
  if (review?.state === "checking" && (review.startedAt || 0) > now - 90_000) return inProgress();
  if (review?.state === "unavailable" && (review.retryAfter || 0) > now) return inProgress("输出审核服务暂时不可用，视频已暂缓展示，稍后重试。");
  if (status.state === "fail") {
    await db.update(videoGeneration).set({ status: "failed", videoUrl: null, error: status.error || "视频生成失败。",
      rawResponse: safeRaw(record), updatedAt: new Date() }).where(eq(videoGeneration.id, record.id));
    return { status: "fail", error: status.error };
  }
  if (status.state !== "success" || !status.videoUrl) return { status: "generating" };

  const startedAt = Date.now();
  const checking: Review = { state: "checking", startedAt, provider: "google_video_intelligence" };
  const claimed = await db.update(videoGeneration).set({ status: "processing", videoUrl: null, error: null,
    rawResponse: safeRaw(record, checking), updatedAt: new Date() }).where(and(
      eq(videoGeneration.id, record.id),
      sql`COALESCE(${videoGeneration.rawResponse}->'outputReview'->>'state', '') NOT IN ('approved','blocked','review')`,
      sql`(COALESCE(${videoGeneration.rawResponse}->'outputReview'->>'state', '') <> 'checking'
      OR COALESCE((${videoGeneration.rawResponse}->'outputReview'->>'startedAt')::bigint, 0) < ${startedAt - 90_000})`,
    )).returning({ id: videoGeneration.id });
  if (!claimed.length) return inProgress();

  let verdict: OutputVerdict;
  try { verdict = await moderateVideoOutput(status.videoUrl); }
  catch { verdict = { state: "unavailable", provider: "google_video_intelligence", code: "transport" }; }

  const next: Review = { state: verdict.state, startedAt, checkedAt: Date.now(), provider: "google_video_intelligence",
    ...(verdict.operationName ? { operationName: verdict.operationName } : {}),
    ...(verdict.stagedObject ? { stagedObject: verdict.stagedObject } : {}),
    ...(verdict.code ? { code: verdict.code } : {}),
    ...(verdict.state === "unavailable" ? { retryAfter: Date.now() + 30_000 } : {}) };
  const pending = verdict.state === "checking";
  const allowed = verdict.state === "approved";
  const denied = verdict.state === "review" || verdict.state === "blocked";
  const completed = await db.update(videoGeneration).set({
    status: allowed ? "completed" : denied ? "review" : "processing",
    videoUrl: allowed ? status.videoUrl : null,
    error: denied ? held(verdict.state as "blocked" | "review").error : null,
    rawResponse: safeRaw(record, next), updatedAt: new Date(),
  }).where(and(
    eq(videoGeneration.id, record.id),
    sql`${videoGeneration.rawResponse}->'outputReview'->>'state' = 'checking'`,
    sql`(${videoGeneration.rawResponse}->'outputReview'->>'startedAt')::bigint = ${startedAt}`,
  )).returning({ id: videoGeneration.id });
  if (!completed.length) return inProgress();
  if (!pending && verdict.stagedObject) await removeStagedModerationVideo(verdict.stagedObject);

  if (allowed) {
    if (record.projectId) await db.update(workflowJobs).set({
      status: "completed", resultUrl: status.videoUrl,
      output: { providerTaskId: record.taskId, videoUrl: status.videoUrl, outputReview: next },
      completedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(workflowJobs.externalTaskId, record.taskId), eq(workflowJobs.projectId, record.projectId)));
    if (record.sceneId && record.projectVersionId) await db.update(sceneVersions).set({
      generatedVideoUrl: status.videoUrl, updatedAt: new Date(),
    }).where(and(eq(sceneVersions.originalSceneId, record.sceneId), eq(sceneVersions.projectVersionId, record.projectVersionId)));
    return { status: "success", videoUrl: status.videoUrl };
  }
  if (denied) return held(verdict.state as "blocked" | "review");
  return inProgress(pending ? "视频已生成，Google 正在审核输出内容。" : "输出审核服务暂时不可用，视频已暂缓展示，稍后重试。");
}
