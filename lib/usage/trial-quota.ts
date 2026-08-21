import { and, count, desc, eq, sql } from "drizzle-orm";
import { analysisHistory, db, operationLogs, user, userApiKeys } from "@/lib/db";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";

type AnalyzeProvider = "zhipu" | "gemini" | "openrouter";
const ANALYZE_PROVIDERS: AnalyzeProvider[] = ["openrouter", "zhipu", "gemini"];
export type AnalyzeApiKeySource = "user" | "platform";

const DEFAULT_TRIAL_LIMIT = 2;

export class TrialQuotaError extends Error {
  limit: number;
  used: number;
  remaining: number;

  constructor(limit: number, used: number) {
    super(`Trial quota used up. Each user can analyze videos ${limit} times with the platform API key.`);
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

export function decodeAnalyzeApiKey(storedApiKey: string): string | null {
  const trimmed = storedApiKey.trim();
  if (!trimmed) return null;
  if (!isValidEncryptedKey(trimmed)) return trimmed;

  try {
    return decryptApiKey(trimmed).trim() || null;
  } catch {
    return null;
  }
}

async function hasUsableUserAnalyzeApiKey(userId: string, provider: AnalyzeProvider) {
  const records = await db.query.userApiKeys.findMany({
    where: and(
      eq(userApiKeys.userId, userId),
      eq(userApiKeys.provider, provider),
      eq(userApiKeys.isActive, true),
    ),
    orderBy: [desc(userApiKeys.updatedAt), desc(userApiKeys.createdAt)],
  });

  return records.some((record) => Boolean(decodeAnalyzeApiKey(record.apiKey)));
}

export async function getUsableUserAnalyzeApiKeyProvider(
  userId: string,
  preferredProvider?: AnalyzeProvider,
): Promise<AnalyzeProvider | null> {
  const providers = [
    ...(preferredProvider ? [preferredProvider] : []),
    ...ANALYZE_PROVIDERS.filter((provider) => provider !== preferredProvider),
  ];

  for (const provider of providers) {
    if (await hasUsableUserAnalyzeApiKey(userId, provider)) return provider;
  }

  return null;
}

async function getPlatformAnalyzeUsage(userId: string) {
  const platformLogRows = await db
    .select({ count: count() })
    .from(operationLogs)
    .where(
      and(
        eq(operationLogs.userId, userId),
        eq(operationLogs.action, "analysis.complete"),
        sql`(${operationLogs.metadata}->>'apiKeySource' = 'platform' OR ${operationLogs.metadata}->>'apiKeySource' IS NULL)`,
      ),
    );

  const historyRows = await db
    .select({ count: count() })
    .from(analysisHistory)
    .where(eq(analysisHistory.userId, userId));

  return Math.max(platformLogRows[0]?.count || 0, historyRows[0]?.count || 0);
}

export async function getUserTrialUsage(userId: string, provider?: AnalyzeProvider) {
  const limit = getTrialLimit();
  const currentUser = await db.query.user.findFirst({ where: eq(user.id, userId) });

  if (currentUser?.role === "admin") {
    return {
      limit,
      used: 0,
      remaining: Number.POSITIVE_INFINITY,
      isAdmin: true,
      hasOwnApiKey: false,
      apiKeySource: "platform" as AnalyzeApiKeySource,
    };
  }

  const hasOwnApiKey = Boolean(await getUsableUserAnalyzeApiKeyProvider(userId, provider));
  if (hasOwnApiKey) {
    return {
      limit,
      used: 0,
      remaining: Number.POSITIVE_INFINITY,
      isAdmin: false,
      hasOwnApiKey: true,
      apiKeySource: "user" as AnalyzeApiKeySource,
    };
  }

  const used = await getPlatformAnalyzeUsage(userId);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    isAdmin: false,
    hasOwnApiKey: false,
    apiKeySource: "platform" as AnalyzeApiKeySource,
  };
}

export async function assertTrialQuota(userId: string, provider?: AnalyzeProvider) {
  const quota = await getUserTrialUsage(userId, provider);
  if (!quota.isAdmin && !quota.hasOwnApiKey && quota.used >= quota.limit) {
    throw new TrialQuotaError(quota.limit, quota.used);
  }
  return quota;
}

export function trialQuotaResponse(error: unknown) {
  if (!(error instanceof TrialQuotaError)) return null;
  return {
    error: "您的平台免费视频分析额度已经用完。每个账号最多可使用平台 API Key 免费分析 2 次视频。配置自己的 API Key 后可以继续使用。",
    code: "TRIAL_QUOTA_EXCEEDED",
    limit: error.limit,
    used: error.used,
    remaining: error.remaining,
  };
}