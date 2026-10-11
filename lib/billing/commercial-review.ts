import { and, asc, eq, sql } from "drizzle-orm";
import { commercialLedger, commercialReservations, commercialTasks, db, projects, projectVersions, sceneVersions } from "@/lib/db";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";

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
    const review = { reason: previous.reason || "legacy_review", enteredAt: previous.enteredAt || task.updatedAt.toISOString(), deadlineAt: previous.deadlineAt || at, ...previous, action: "manual_reconciliation", nextActionAt: at, escalatedAt: at, reservedCredits: previous.reservedCredits ?? task.credits };
    const event = { at, action: "escalated_for_manual_reconciliation", reason: review.reason };
    const [updated] = await db.update(commercialTasks).set({ result: sql`jsonb_set(${commercialTasks.result} || ${JSON.stringify({ review })}::jsonb, '{reviewHistory}', COALESCE(${commercialTasks.result}->'reviewHistory', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)`, updatedAt: new Date(at) })
      .where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "review"), due)).returning({ id: commercialTasks.id });
    if (updated) { escalated++; console.error("commercial.review.escalated", { taskId: task.id, reason: review.reason, deadlineAt: review.deadlineAt }); }
  }
  return escalated;
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
