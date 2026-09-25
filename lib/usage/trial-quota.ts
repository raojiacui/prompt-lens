import { and, count, eq, lt, sql } from "drizzle-orm";
import { db, operationLogs, trialAnalysisUsage, user } from "@/lib/db";
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

export async function reserveTrialAnalysis(userId: string) {
  const quota = await getUserTrialUsage(userId);
  if (quota.isAdmin) return;
  await db.insert(trialAnalysisUsage).values({ userId, used: quota.used }).onConflictDoNothing({ target: trialAnalysisUsage.userId });
  const [claimed] = await db.update(trialAnalysisUsage)
    .set({ used: sql`${trialAnalysisUsage.used} + 1`, updatedAt: new Date() })
    .where(and(eq(trialAnalysisUsage.userId, userId), lt(trialAnalysisUsage.used, quota.limit)))
    .returning({ used: trialAnalysisUsage.used });
  if (!claimed) {
    const latest = await getUserTrialUsage(userId);
    throw new TrialQuotaError(latest.limit, latest.used);
  }
}

export async function releaseTrialAnalysis(userId: string) {
  await db.update(trialAnalysisUsage)
    .set({ used: sql`greatest(0, ${trialAnalysisUsage.used} - 1)`, updatedAt: new Date() })
    .where(eq(trialAnalysisUsage.userId, userId));
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
