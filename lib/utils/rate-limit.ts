import { sql } from "drizzle-orm";
import { apiRateLimits, db } from "@/lib/db";

export async function checkRateLimit(identifier: string, limit = 10, windowMs = 60000) {
  if (!identifier || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Invalid rate limit");
  const [entry] = await db.insert(apiRateLimits).values({ key: identifier, count: 1, resetAt: new Date(Date.now() + windowMs) })
    .onConflictDoUpdate({ target: apiRateLimits.key, set: {
      count: sql`CASE WHEN ${apiRateLimits.resetAt} <= now() THEN 1 ELSE least(${apiRateLimits.count} + 1, ${limit + 1}) END`,
      resetAt: sql`CASE WHEN ${apiRateLimits.resetAt} <= now() THEN now() + ${windowMs} * interval '1 millisecond' ELSE ${apiRateLimits.resetAt} END`,
    } }).returning();
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetIn: Math.max(0, entry.resetAt.getTime() - Date.now()) };
}

export const RateLimitConfigs = {
  analyze: { limit: 5, windowMs: 60000 },
  upload: { limit: 10, windowMs: 60000 },
  default: { limit: 20, windowMs: 60000 },
};
