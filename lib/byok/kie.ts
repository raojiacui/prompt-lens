import { db, userApiKeys } from "@/lib/db";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";
import { and, eq } from "drizzle-orm";

function decryptStoredApiKey(apiKey: string) {
  if (!isValidEncryptedKey(apiKey)) return apiKey;
  try {
    return decryptApiKey(apiKey);
  } catch {
    throw new Error("保存的 KIE API Key 无法解密。请确认 BYOK_ENCRYPTION_KEY 没有变更，或在设置中删除后重新保存 KIE API Key。");
  }
}

export async function getUserKieApiKey(userId: string): Promise<string | null> {
  const record = await db.query.userApiKeys.findFirst({
    where: and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, "kie")),
  });

  if (!record || !record.isActive) return null;
  return decryptStoredApiKey(record.apiKey);
}


export async function getUserApiKeyForProvider(userId: string, provider: string): Promise<string | null> {
  const record = await db.query.userApiKeys.findFirst({
    where: and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider as any)),
  });

  if (!record || !record.isActive) return null;
  return decryptStoredApiKey(record.apiKey);
}
export function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}