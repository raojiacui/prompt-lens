import { count, eq } from "drizzle-orm";
import { analysisHistory, db, user } from "@/lib/db";

const DEFAULT_TRIAL_LIMIT = 2;

export class TrialQuotaError extends Error {
  status = 402;
  limit: number;
  used: number;
  remaining: number;

  constructor(limit: number, used: number) {
    super(`Trial quota used up. Each user can analyze videos ${limit} times for free.`);
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

  if (currentUser?.role === "admin") {
    return { limit, used: 0, remaining: Number.POSITIVE_INFINITY, isAdmin: true };
  }

  const rows = await db.select({ count: count() }).from(analysisHistory).where(eq(analysisHistory.userId, userId));
  const used = rows[0]?.count || 0;
  return { limit, used, remaining: Math.max(0, limit - used), isAdmin: false };
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
    error: "你的免费视频分析试用额度已经用完。每个账号可以免费分析 2 次视频。",
    code: "TRIAL_QUOTA_EXCEEDED",
    limit: error.limit,
    used: error.used,
    remaining: error.remaining,
  };
}