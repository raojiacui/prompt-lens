import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { commercialLedger, commercialReservations, commercialTasks, db, projects, projectVersions, sceneVersions } from "@/lib/db";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { sendEmail } from "@/lib/email/smtp";

export function canFullyReleaseTask(task: { state: string; kind: string; result: unknown } | undefined) {
  if (!task || task.state !== "review" || task.kind !== "analysis") return false;
  const result = task.result as { review?: unknown; successfulSceneIds?: unknown; splitDelivered?: unknown; pendingResult?: unknown } | null;
  return Boolean(result?.review) && (!Array.isArray(result?.successfulSceneIds) || result.successfulSceneIds.length === 0)
    && result?.splitDelivered !== true && !result?.pendingResult;
}

export async function escalateOverdueCommercialReviews(limit = 5) {
  const due = sql`COALESCE(NULLIF(${commercialTasks.result}->'review'->>'deadlineAt', '')::timestamptz, ${commercialTasks.updatedAt} + interval '1 hour') <= now()
    AND ${commercialTasks.result}->'review'->>'escalatedAt' IS NULL`;
  const candidates = await db.select({ id: commercialTasks.id, result: commercialTasks.result, updatedAt: commercialTasks.updatedAt, credits: commercialTasks.credits })
    .from(commercialTasks).where(and(eq(commercialTasks.state, "review"), due)).orderBy(asc(commercialTasks.updatedAt)).limit(limit);
  let escalated = 0;
  for (const task of candidates) {
    const at = new Date().toISOString();
    const previous = (task.result as { review?: Record<string, unknown> }).review || {};
    const defaults = { reason: "legacy_review", enteredAt: task.updatedAt.toISOString(), deadlineAt: at, reservedCredits: task.credits };
    const patch = { action: "manual_reconciliation", nextActionAt: at, nextFollowUpAt: at, escalatedAt: at };
    const event = { at, action: "escalated_for_manual_reconciliation", reason: previous.reason || "legacy_review" };
    const [updated] = await db.update(commercialTasks).set({ result: sql`jsonb_set(jsonb_set(${commercialTasks.result}, '{review}', ${JSON.stringify(defaults)}::jsonb || COALESCE(${commercialTasks.result}->'review', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb), '{reviewHistory}', COALESCE(${commercialTasks.result}->'reviewHistory', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)`, updatedAt: new Date(at) })
      .where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "review"), due)).returning({ id: commercialTasks.id });
    if (updated) { escalated++; console.error("commercial.review.escalated", { taskId: task.id, reason: event.reason, deadlineAt: previous.deadlineAt || at }); }
  }
  return escalated;
}

export async function acknowledgeCommercialReview(taskId: string, actorId: string) {
  const at = new Date();
  const event = { action: "review_acknowledged", actorId, at: at.toISOString() };
  const [claimed] = await db.update(commercialTasks).set({ result: sql`jsonb_set(jsonb_set(${commercialTasks.result}, '{review}', COALESCE(${commercialTasks.result}->'review', '{}'::jsonb) || ${JSON.stringify({ assignedTo: actorId, acknowledgedAt: at.toISOString(), nextFollowUpAt: new Date(at.getTime() + 24 * 60 * 60_000).toISOString() })}::jsonb), '{reviewHistory}', COALESCE(${commercialTasks.result}->'reviewHistory', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)`, updatedAt: at })
    .where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.state, "review"), sql`${commercialTasks.result}->'review' IS NOT NULL`, sql`(${commercialTasks.result}->'review'->>'assignedTo' IS NULL OR ${commercialTasks.result}->'review'->>'assignedTo' = ${actorId})`)).returning({ id: commercialTasks.id });
  if (!claimed) throw new Error("REVIEW_NOT_AVAILABLE");
}

export async function notifyDueCommercialReviews(limit = 5) {
  const recipient = process.env.COMMERCIAL_REVIEW_ALERT_EMAIL?.trim();
  if (!recipient) throw new Error("COMMERCIAL_REVIEW_ALERT_EMAIL_REQUIRED");
  const due = sql`${commercialTasks.result}->'review'->>'escalatedAt' IS NOT NULL AND COALESCE(NULLIF(${commercialTasks.result}->'review'->>'nextFollowUpAt', '')::timestamptz, ${commercialTasks.updatedAt}) <= now()`;
  const candidates = await db.select({ id: commercialTasks.id, kind: commercialTasks.kind, result: commercialTasks.result }).from(commercialTasks)
    .where(and(eq(commercialTasks.state, "review"), due)).orderBy(asc(commercialTasks.updatedAt)).limit(limit);
  let sent = 0;
  for (const task of candidates) {
    const claimId = crypto.randomUUID();
    const now = new Date();
    const [claimed] = await db.update(commercialTasks).set({ result: sql`jsonb_set(${commercialTasks.result}, '{review}', ${commercialTasks.result}->'review' || ${JSON.stringify({ notificationClaim: claimId, nextFollowUpAt: new Date(now.getTime() + 5 * 60_000).toISOString() })}::jsonb)` })
      .where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "review"), due)).returning({ id: commercialTasks.id });
    if (!claimed) continue;
    const review = (task.result as { review?: { reason?: string; assignedTo?: string; deadlineAt?: string } }).review;
    try {
      await sendEmail({ to: recipient, subject: `[Prompt Lens] 商业任务待复核 ${task.id}`, text: `任务 ${task.id}\n类型 ${task.kind}\n原因 ${review?.reason || "unknown"}\n负责人 ${review?.assignedTo || "未认领"}\n期限 ${review?.deadlineAt || "未记录"}\n请进入后台商业复核列表处理。`, html: `<p>商业任务 ${task.id} 需要复核，请进入后台查看。</p>` });
      const at = new Date();
      const event = { action: "review_alert_accepted_by_smtp", at: at.toISOString(), claimId };
      await db.update(commercialTasks).set({ result: sql`jsonb_set(jsonb_set(${commercialTasks.result}, '{review}', ${commercialTasks.result}->'review' || ${JSON.stringify({ lastNotifiedAt: at.toISOString(), nextFollowUpAt: new Date(at.getTime() + (review?.assignedTo ? 24 * 60 * 60_000 : 60 * 60_000)).toISOString(), lastNotificationError: null })}::jsonb), '{reviewHistory}', COALESCE(${commercialTasks.result}->'reviewHistory', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)` })
        .where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "review"), sql`${commercialTasks.result}->'review'->>'notificationClaim' = ${claimId}`));
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "SMTP delivery failed";
      console.error("commercial.review.alert_failed", { taskId: task.id, error: message });
      await db.update(commercialTasks).set({ result: sql`jsonb_set(${commercialTasks.result}, '{review}', ${commercialTasks.result}->'review' || ${JSON.stringify({ nextFollowUpAt: new Date(Date.now() + 10 * 60_000).toISOString(), lastNotificationError: message })}::jsonb)` })
        .where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "review"), sql`${commercialTasks.result}->'review'->>'notificationClaim' = ${claimId}`));
    }
  }
  return sent;
}

export async function releaseUnfulfilledCommercialAnalysis(input: { reservationId: string; actorId: string; evidence: string }) {
  if (input.evidence.trim().length < 12 || input.evidence.length > 2000 || !input.actorId) throw new Error("REVIEW_EVIDENCE_REQUIRED");
  const reservation = await db.query.commercialReservations.findFirst({ where: eq(commercialReservations.id, input.reservationId) });
  if (!reservation || reservation.state !== "held" || Date.now() - reservation.createdAt.getTime() < 86400000 || !reservation.taskKey.startsWith("commercial:")) throw new Error("RESERVATION_NOT_ELIGIBLE");
  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, reservation.taskKey.slice(11)), eq(commercialTasks.userId, reservation.userId))).for("update");
    if (!task || !canFullyReleaseTask(task)) throw new Error("TASK_NOT_ELIGIBLE_FOR_FULL_RELEASE");
    const taskInput = task.input as { projectId?: string; retry?: unknown; pricing?: { automaticSplit?: boolean } };
    if (taskInput.retry) throw new Error("RETRY_REQUIRES_INDIVIDUAL_RECONCILIATION");
    if (!taskInput.projectId || typeof taskInput.pricing?.automaticSplit !== "boolean") throw new Error("INCOMPLETE_ANALYSIS_CHECKPOINT");
    const [deliveredScene] = await tx.select({ id: sceneVersions.id }).from(sceneVersions).where(and(eq(sceneVersions.projectId, taskInput.projectId), sql`(${sceneVersions.metadata}->>'analysisProvider' = 'kie' OR ${sceneVersions.generationPrompt} <> '')`)).limit(1);
    if (deliveredScene) throw new Error("DELIVERED_SCENE_EXISTS");
    if (taskInput.pricing.automaticSplit) {
      const [deliveredSplit] = await tx.select({ id: projectVersions.id }).from(projectVersions).where(eq(projectVersions.projectId, taskInput.projectId)).limit(1);
      if (deliveredSplit) throw new Error("DELIVERED_SPLIT_EXISTS");
    }
    const current = await tx.query.commercialReservations.findFirst({ where: eq(commercialReservations.id, reservation.id) });
    if (current?.state !== "held") throw new Error("RESERVATION_ALREADY_SETTLED");
    await settleCommercialTaskInTransaction(tx, { userId: reservation.userId, taskKey: reservation.taskKey, credits: 0, rewrites: 0 });
    await tx.insert(commercialLedger).values({ userId: reservation.userId, eventKey: `review-release:${reservation.id}`, credits: 0, rewrites: 0, metadata: { actorId: input.actorId, evidence: input.evidence, reservationId: reservation.id } }).onConflictDoNothing();
    const resolvedAt = new Date();
    const event = { action: "manual_full_release", actorId: input.actorId, at: resolvedAt.toISOString(), evidence: input.evidence };
    await tx.update(commercialTasks).set({ state: "failed", result: sql`jsonb_set(${commercialTasks.result} || ${JSON.stringify({ chargedCredits: 0, manualRelease: true, reviewResolution: event })}::jsonb, '{reviewHistory}', COALESCE(${commercialTasks.result}->'reviewHistory', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)`, updatedAt: resolvedAt }).where(eq(commercialTasks.id, task.id));
    if (taskInput.projectId && !taskInput.retry) await tx.update(projects).set({ status: "failed", updatedAt: resolvedAt }).where(and(eq(projects.id, taskInput.projectId), eq(projects.userId, task.userId), eq(projects.status, "analyzing")));
  });
}
