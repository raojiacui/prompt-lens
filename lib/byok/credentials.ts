import { and, desc, eq, inArray } from "drizzle-orm";
import { db, userApiKeys } from "@/lib/db";
import { USER_PROVIDERS, type UserProvider } from "@/lib/ai/providers";
import { decodeStoredApiKey, getUserApiKeyForProvider } from "./keys";

export type UserCredential = { provider: UserProvider; apiKey: string };

/** Explicit provider pins historical tasks; current preference only affects new work. */
export async function getUserCredential(userId: string, provider?: UserProvider): Promise<UserCredential | null> {
  if (provider) {
    const apiKey = await getUserApiKeyForProvider(userId, provider);
    return apiKey ? { provider, apiKey } : null;
  }
  const records = await db.query.userApiKeys.findMany({
    where: and(eq(userApiKeys.userId, userId), inArray(userApiKeys.provider, [...USER_PROVIDERS]), eq(userApiKeys.isActive, true)),
    orderBy: [desc(userApiKeys.updatedAt), desc(userApiKeys.createdAt)],
  });
  // Existing KIE users keep their provider until they explicitly switch it.
  const preferred = records.find(record => record.isPreferred)?.provider
    || (records.some(record => record.provider === "kie") ? "kie" : "infistar");
  const record = records.find(record => record.provider === preferred);
  if (!record) return null;
  const apiKey = decodeStoredApiKey(record.apiKey);
  if (!apiKey) throw new Error("保存的 API Key 无法解密，请在设置中重新保存。");
  return { provider: preferred as UserProvider, apiKey };
}
