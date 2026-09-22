import { db, userApiKeys } from "@/lib/db";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";
import { and, desc, eq } from "drizzle-orm";

export function decodeStoredApiKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  if (!isValidEncryptedKey(trimmed)) return trimmed;

  try {
    return decryptApiKey(trimmed).trim() || null;
  } catch {
    return null;
  }
}

export async function getUserKieApiKey(userId: string): Promise<string | null> {
  return getUserApiKeyForProvider(userId, "kie");
}

export async function getUserApiKeyForProvider(userId: string, provider: string): Promise<string | null> {
  const records = await db.query.userApiKeys.findMany({
    where: and(
      eq(userApiKeys.userId, userId),
      eq(userApiKeys.provider, provider as (typeof userApiKeys.provider.enumValues)[number]),
      eq(userApiKeys.isActive, true),
    ),
    orderBy: [desc(userApiKeys.updatedAt), desc(userApiKeys.createdAt)],
  });

  for (const record of records) {
    const apiKey = decodeStoredApiKey(record.apiKey);
    if (apiKey) return apiKey;
  }

  if (records.some((record) => isValidEncryptedKey(record.apiKey.trim()))) {
    throw new Error("保存的 KIE API Key 无法解密。请确认 BYOK_ENCRYPTION_KEY 没有变更，或在设置中删除后重新保存 KIE API Key。");
  }

  return null;
}
export function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}
