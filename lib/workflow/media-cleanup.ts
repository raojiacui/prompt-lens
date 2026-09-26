import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db, mediaCleanupJobs, projectAssets, referenceVideos, sceneVersions, videoScenes } from "@/lib/db";
import { deleteFromR2, getR2PublicUrl } from "@/lib/cloudflare/r2";

async function hasLiveReference(key: string) {
  const url = getR2PublicUrl(key);
  const [references, scenes, versions, assets] = await Promise.all([
    db.select({ id: referenceVideos.id }).from(referenceVideos).where(or(
      eq(referenceVideos.storageKey, key), inArray(referenceVideos.sourceUrl, [url, key]),
      sql`${referenceVideos.metadata}->>'audioPreviewUrl' IN (${url}, ${key})`,
    )).limit(1),
    db.select({ id: videoScenes.id }).from(videoScenes).where(or(
      inArray(videoScenes.clipUrl, [url, key]), inArray(videoScenes.audioUrl, [url, key]),
      sql`${videoScenes.keyframeUrls} @> ${JSON.stringify([url])}::jsonb`,
      sql`${videoScenes.keyframeUrls} @> ${JSON.stringify([key])}::jsonb`,
    )).limit(1),
    db.select({ id: sceneVersions.id }).from(sceneVersions).where(inArray(sceneVersions.generatedVideoUrl, [url, key])).limit(1),
    db.select({ id: projectAssets.id }).from(projectAssets).where(or(eq(projectAssets.storageKey, key), inArray(projectAssets.url, [url, key]))).limit(1),
  ]);
  return Boolean(references.length || scenes.length || versions.length || assets.length);
}

export async function processMediaCleanupJobs(limit = 10, onlyKeys?: string[]) {
  let deleted = 0;
  for (let index = 0; index < limit; index++) {
    const due = sql`((${mediaCleanupJobs.state} = 'pending' AND ${mediaCleanupJobs.nextAttemptAt} <= now()) OR (${mediaCleanupJobs.state} = 'working' AND ${mediaCleanupJobs.updatedAt} < now() - interval '6 minutes'))`;
    const [candidate] = await db.select({ id: mediaCleanupJobs.id }).from(mediaCleanupJobs).where(and(onlyKeys ? inArray(mediaCleanupJobs.storageKey, onlyKeys) : undefined, due)).orderBy(asc(mediaCleanupJobs.nextAttemptAt)).limit(1);
    if (!candidate) break;
    const [job] = await db.update(mediaCleanupJobs).set({ state: "working", updatedAt: new Date() }).where(and(
      eq(mediaCleanupJobs.id, candidate.id), due,
    )).returning();
    if (!job) continue;
    try {
      if (await hasLiveReference(job.storageKey)) {
        await db.update(mediaCleanupJobs).set({ state: "pending", nextAttemptAt: new Date(Date.now() + 3600_000), updatedAt: new Date() }).where(eq(mediaCleanupJobs.id, job.id));
        continue;
      }
      await deleteFromR2(job.storageKey);
      await db.update(mediaCleanupJobs).set({ state: "deleted", deletedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(mediaCleanupJobs.id, job.id));
      deleted++;
    } catch (error) {
      const attempts = job.attempts + 1;
      await db.update(mediaCleanupJobs).set({ state: "pending", attempts, lastError: error instanceof Error ? error.message.slice(0, 500) : "Storage deletion failed", nextAttemptAt: new Date(Date.now() + Math.min(24 * 3600_000, 60_000 * 2 ** Math.min(attempts, 10))), updatedAt: new Date() }).where(eq(mediaCleanupJobs.id, job.id));
    }
  }
  return deleted;
}
