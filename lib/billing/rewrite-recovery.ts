import { and, asc, eq, sql } from "drizzle-orm";
import { commercialReservations, commercialWallets, db, sceneVersions } from "@/lib/db";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { REWRITE_STALE_MS } from "@/lib/workflow/rewrite-execution";

// The route is capped at 300s. Recover only after a further one-minute grace.
// Recovery settles existing work and never invokes an AI model.
export async function recoverExpiredCommercialRewrites(options: { userId?: string; taskKey?: string; limit?: number } = {}) {
  const cutoff = new Date(Date.now() - REWRITE_STALE_MS);
  const candidates = await db.select({ id: commercialReservations.id, userId: commercialReservations.userId })
    .from(commercialReservations).where(and(eq(commercialReservations.state, "held"),
      sql`${commercialReservations.taskKey} LIKE 'rewrite:%'`, sql`${commercialReservations.createdAt} < ${cutoff.toISOString()}::timestamptz`,
      options.userId ? eq(commercialReservations.userId, options.userId) : undefined,
      options.taskKey ? eq(commercialReservations.taskKey, options.taskKey) : undefined))
    .orderBy(asc(commercialReservations.createdAt)).limit(options.limit ?? 10);
  let recovered = 0;
  for (const candidate of candidates) {
    const settled = await db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '15s', true)`);
      // Match the wallet -> reservation locking order used by normal settlement.
      await tx.select({ id: commercialWallets.userId }).from(commercialWallets).where(eq(commercialWallets.userId, candidate.userId)).for("update");
      const [reservation] = await tx.select().from(commercialReservations).where(and(eq(commercialReservations.id, candidate.id), eq(commercialReservations.state, "held"))).for("update");
      if (!reservation || reservation.createdAt.getTime() >= cutoff.getTime() || !reservation.taskKey.startsWith("rewrite:")) return false;
      const quote = reservation.quote as { projectId?: string };
      const [saved] = await tx.select({ id: sceneVersions.id }).from(sceneVersions).where(and(
        quote.projectId ? eq(sceneVersions.projectId, quote.projectId) : sql`false`,
        sql`${sceneVersions.metadata}->>'commercialTaskKey' = ${reservation.taskKey}`)).limit(1);
      await settleCommercialTaskInTransaction(tx, { userId: reservation.userId, taskKey: reservation.taskKey, credits: 0, rewrites: saved ? 1 : 0 });
      await tx.update(commercialReservations).set({ quote: sql`${commercialReservations.quote} || ${JSON.stringify({ rewriteRecovery: { code: saved ? "REWRITE_RESULT_RECOVERED" : "REWRITE_EXPIRED", recoveredAt: new Date().toISOString() } })}::jsonb` }).where(eq(commercialReservations.id, reservation.id));
      return true;
    });
    if (settled) { recovered++; console.info("commercial.rewrite.recovered", { reservationId: candidate.id }); }
  }
  return recovered;
}
