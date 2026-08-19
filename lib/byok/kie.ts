import { db, userApiKeys } from "@/lib/db";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";
import { and, eq } from "drizzle-orm";

export async function getUserKieApiKey(userId: string): Promise<string | null> {
  const record = await db.query.userApiKeys.findFirst({
    where: and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, "kie")),
  });

  if (!record || !record.isActive) return null;
  if (isValidEncryptedKey(record.apiKey)) return decryptApiKey(record.apiKey);
  return record.apiKey;
}

export function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}