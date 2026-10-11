import { and, asc, eq, sql } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";

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
