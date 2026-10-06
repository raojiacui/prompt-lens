import { resolveLinkedMediaWithEasyDown } from "./easydown";
import type { ResolvedLinkedMediaSource } from "./source-platform";

const cacheLifetimeMs = 10 * 60_000;
const cacheLimit = 128;
const resolvedSources = new Map<string, { expiresAt: number; source: Promise<ResolvedLinkedMediaSource> }>();

export async function resolveLinkedMedia(url: string, userId?: string) {
  if (!userId) return resolveLinkedMediaWithEasyDown(url);
  const now = Date.now();
  for (const [key, entry] of resolvedSources) {
    if (entry.expiresAt <= now) resolvedSources.delete(key);
  }
  const cacheKey = JSON.stringify([userId, url]);
  const existing = resolvedSources.get(cacheKey);
  if (existing) return existing.source;
  if (resolvedSources.size >= cacheLimit) throw new Error("链接解析服务繁忙，本次尚未调用收费解析接口，请稍后重试。");

  // Reuse successful provider responses after download failures; cache is private to this server process and user.
  const source = resolveLinkedMediaWithEasyDown(url);
  const entry = { expiresAt: now + cacheLifetimeMs, source };
  resolvedSources.set(cacheKey, entry);
  try {
    const result = await source;
    entry.expiresAt = Date.now() + cacheLifetimeMs;
    return result;
  } catch (error) {
    if (resolvedSources.get(cacheKey) === entry) resolvedSources.delete(cacheKey);
    throw error;
  }
}
