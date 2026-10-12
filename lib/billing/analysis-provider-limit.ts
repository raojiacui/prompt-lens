import { and, eq, sql } from "drizzle-orm";
import { analysisProviderSlots, db } from "@/lib/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every instance takes the same PostgreSQL lock for this key before counting.
// A slot remains conservative after a worker crash until its six-minute lease expires.
export async function reserveAnalysisProviderSlot(tx: Transaction, sceneJobId: string, keyFingerprint: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`analysis-provider:${keyFingerprint}`}))`);
  const [usage] = await tx.select({
    active: sql<number>`count(*) FILTER (WHERE ${analysisProviderSlots.releasedAt} IS NULL AND ${analysisProviderSlots.leaseUntil} > now())::int`,
    recent: sql<number>`count(*) FILTER (WHERE ${analysisProviderSlots.startedAt} > now() - interval '10 seconds')::int`,
  }).from(analysisProviderSlots).where(eq(analysisProviderSlots.keyFingerprint, keyFingerprint));
  if (usage.active >= 4 || usage.recent >= 15) return false;
  const [slot] = await tx.insert(analysisProviderSlots).values({ sceneJobId, keyFingerprint, leaseUntil: new Date(Date.now() + 6 * 60_000) }).onConflictDoNothing().returning({ sceneJobId: analysisProviderSlots.sceneJobId });
  return Boolean(slot);
}

export async function releaseAnalysisProviderSlot(sceneJobId: string) {
  await db.update(analysisProviderSlots).set({ releasedAt: new Date() }).where(and(eq(analysisProviderSlots.sceneJobId, sceneJobId), sql`${analysisProviderSlots.releasedAt} IS NULL`));
}

export async function pruneAnalysisProviderSlots() {
  await db.delete(analysisProviderSlots).where(and(sql`${analysisProviderSlots.startedAt} < now() - interval '1 day'`, sql`(${analysisProviderSlots.releasedAt} IS NOT NULL OR ${analysisProviderSlots.leaseUntil} < now())`));
}
