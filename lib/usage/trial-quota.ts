import { and, count, eq, lt, sql } from "drizzle-orm";
import { commercialTasks, db, operationLogs, trialAnalysisReservations, trialAnalysisUsage, user } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { isAdminProfile } from "@/lib/auth";

const DEFAULT_TRIAL_LIMIT = 2;

export class TrialQuotaError extends Error {
  status = 402;
  limit: number;
  used: number;
  remaining: number;

  constructor(limit: number, used: number) {
    super(`Trial quota used up. Each user can try ${limit} video analysis actions.`);
    this.name = "TrialQuotaError";
    this.limit = limit;
    this.used = used;
    this.remaining = Math.max(0, limit - used);
  }
}

function getTrialLimit() {
  const parsed = Number(process.env.TRIAL_USAGE_LIMIT || DEFAULT_TRIAL_LIMIT);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_TRIAL_LIMIT;
}

export async function getUserTrialUsage(userId: string) {
  const limit = getTrialLimit();
  const currentUser = await db.query.user.findFirst({ where: eq(user.id, userId) });

  if (isAdminProfile(currentUser)) {
    return { limit, used: 0, remaining: Number.POSITIVE_INFINITY, isAdmin: true };
  }

  await expireTrialReservations(userId);
  const usage = await db.query.trialAnalysisUsage.findFirst({ where: eq(trialAnalysisUsage.userId, userId) });
  if (usage) return { limit, used: usage.used, remaining: Math.max(0, limit - usage.used), isAdmin: false };

  const [trialRows] = await db.select({ count: count() }).from(operationLogs).where(and(
    eq(operationLogs.userId, userId),
    eq(operationLogs.action, "analysis.complete"),
    sql`${operationLogs.metadata}->>'billingMode' = 'trial'`,
  ));

  const used = trialRows?.count || 0;

  return { limit, used, remaining: Math.max(0, limit - used), isAdmin: false };
}

export async function reserveTrialAnalysis(userId: string, taskKey: string = randomUUID()) {
  const quota = await getUserTrialUsage(userId);
  if (quota.isAdmin) return null;
  return db.transaction(async (tx) => {
    await tx.insert(trialAnalysisUsage).values({ userId, used: quota.used }).onConflictDoNothing();
    const [usage] = await tx.select().from(trialAnalysisUsage).where(eq(trialAnalysisUsage.userId, userId)).for("update");
    const [existing] = await tx.select().from(trialAnalysisReservations).where(and(eq(trialAnalysisReservations.userId, userId), eq(trialAnalysisReservations.taskKey, taskKey)));
    if (existing) {
      if (existing.state === "released") throw new Error("TRIAL_TASK_ALREADY_RELEASED");
      return existing.id;
    }
    if (usage.used >= quota.limit) throw new TrialQuotaError(quota.limit, usage.used);
    const [reservation] = await tx.insert(trialAnalysisReservations).values({ userId, taskKey, expiresAt: new Date(Date.now() + 30 * 60_000) }).returning();
    await tx.update(trialAnalysisUsage).set({ used: usage.used + 1, updatedAt: new Date() }).where(eq(trialAnalysisUsage.userId, userId));
    return reservation.id;
  });
}

export async function completeTrialAnalysis(reservationId: string | null) {
  if (!reservationId) return;
  const [reservation] = await db.update(trialAnalysisReservations).set({ state: "completed" })
    .where(and(eq(trialAnalysisReservations.id, reservationId), eq(trialAnalysisReservations.state, "pending"), sql`${trialAnalysisReservations.expiresAt} > now()`)).returning();
  if (!reservation) {
    const existing = await db.query.trialAnalysisReservations.findFirst({ where: eq(trialAnalysisReservations.id, reservationId) });
    if (existing?.state !== "completed") throw new Error("TRIAL_RESERVATION_EXPIRED");
  }
}

export async function releaseTrialAnalysis(reservationId: string) {
  await db.transaction(async (tx) => {
    const [released] = await tx.update(trialAnalysisReservations).set({ state: "released" })
      .where(and(eq(trialAnalysisReservations.id, reservationId), eq(trialAnalysisReservations.state, "pending"))).returning();
    if (released) await tx.update(trialAnalysisUsage).set({ used: sql`greatest(0, ${trialAnalysisUsage.used} - 1)`, updatedAt: new Date() }).where(eq(trialAnalysisUsage.userId, released.userId));
  });
}

export async function expireTrialReservations(userId?: string) {
  const expired = await db.select().from(trialAnalysisReservations).where(and(
    eq(trialAnalysisReservations.state, "pending"), lt(trialAnalysisReservations.expiresAt, new Date()),
    userId ? eq(trialAnalysisReservations.userId, userId) : undefined,
  )).limit(100);
  for (const reservation of expired) {
    const [delivered] = await db.select({ id: operationLogs.id }).from(operationLogs).where(and(eq(operationLogs.userId, reservation.userId), eq(operationLogs.action, "analysis.complete"), sql`${operationLogs.metadata}->>'trialReservationId' = ${reservation.id}`)).limit(1);
    const taskId = reservation.taskKey.startsWith("analysis:") ? reservation.taskKey.slice("analysis:".length) : null;
    const task = taskId ? await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, taskId), eq(commercialTasks.userId, reservation.userId)) }) : null;
    if (delivered || Number((task?.result as { successful?: number } | undefined)?.successful || 0) > 0) {
      await db.update(trialAnalysisReservations).set({ state: "completed" }).where(and(eq(trialAnalysisReservations.id, reservation.id), eq(trialAnalysisReservations.state, "pending")));
    } else await releaseTrialAnalysis(reservation.id);
  }
}

export async function assertTrialQuota(userId: string) {
  const quota = await getUserTrialUsage(userId);
  if (!quota.isAdmin && quota.used >= quota.limit) {
    throw new TrialQuotaError(quota.limit, quota.used);
  }
  return quota;
}

export function trialQuotaResponse(error: unknown) {
  if (!(error instanceof TrialQuotaError)) return null;
  return {
    error: "你的两次免费视频分析试用已用完。请在设置中配置自己的 KIE API Key，或购买支持视频分析的积分包。",
    code: "TRIAL_QUOTA_EXCEEDED",
    limit: error.limit,
    used: error.used,
    remaining: error.remaining,
  };
}
