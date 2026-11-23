import { and, desc, eq, like, sql } from "drizzle-orm";
import { db, commercialLedger, commercialLots } from "@/lib/db";

/** Recipient-facing projection: never expose administrator IDs or internal ledger metadata. */
export async function listReceivedGifts(userId: string) {
  return db.select({ id: commercialLedger.id, credits: commercialLedger.credits, rewrites: commercialLedger.rewrites,
    linkImports: sql<number>`coalesce((${commercialLedger.metadata}->>'linkImports')::int, 0)`,
    note: sql<string | null>`${commercialLedger.metadata}->>'note'`,
    createdAt: commercialLedger.createdAt, expiresAt: commercialLots.expiresAt,
    availableCredits: commercialLots.availableCredits, availableRewrites: commercialLots.availableRewrites,
  }).from(commercialLedger).innerJoin(commercialLots, sql`${commercialLots.id}::text = ${commercialLedger.metadata}->>'lotId'`)
    .where(and(eq(commercialLedger.userId, userId), eq(commercialLots.userId, userId),
      like(commercialLedger.eventKey, "admin-grant:%"), sql`${commercialLedger.metadata}->>'source' = 'admin-gift'`))
    .orderBy(desc(commercialLedger.createdAt)).limit(50);
}
