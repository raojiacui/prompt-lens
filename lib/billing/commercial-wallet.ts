import { and, asc, eq } from "drizzle-orm";
import { db, commercialWallets, commercialReservations, commercialLedger, commercialLots, commercialAllocations } from "@/lib/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Amounts = { credits: number; rewrites: number };

function validateAmounts(amount: Amounts) {
  for (const value of [amount.credits, amount.rewrites]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error("Invalid wallet amount");
  }
}

async function lockWallet(tx: Transaction, userId: string) {
  await tx.insert(commercialWallets).values({ userId }).onConflictDoNothing();
  const [wallet] = await tx.select().from(commercialWallets).where(eq(commercialWallets.userId, userId)).for("update");
  return wallet;
}

/** Call inside the same transaction as the order state transition. */
export async function grantCommercialPurchase(tx: Transaction, input: Amounts & { userId: string; orderId: string; packageId: string }) {
  validateAmounts(input);
  const wallet = await lockWallet(tx, input.userId);
  const eventKey = `purchase:${input.orderId}`;
  const [existing] = await tx.select().from(commercialLedger).where(eq(commercialLedger.eventKey, eventKey));
  if (existing) {
    if (existing.userId !== input.userId || existing.credits !== input.credits || existing.rewrites !== input.rewrites) throw new Error("Purchase replay mismatch");
    return false;
  }
  await tx.update(commercialWallets).set({ credits: wallet.credits + input.credits, rewrites: wallet.rewrites + input.rewrites, updatedAt: new Date() }).where(eq(commercialWallets.userId, input.userId));
  await tx.insert(commercialLedger).values({ userId: input.userId, eventKey, credits: input.credits, rewrites: input.rewrites, metadata: { orderId: input.orderId, packageId: input.packageId } });
  await tx.insert(commercialLots).values({ userId: input.userId, orderId: input.orderId, credits: input.credits, rewrites: input.rewrites, availableCredits: input.credits, availableRewrites: input.rewrites });
  return true;
}

export async function reserveCommercialTask(input: Amounts & { userId: string; taskKey: string; quote: Record<string, unknown> }) {
  return db.transaction((tx) => reserveCommercialTaskInTransaction(tx, input));
}

export async function reserveCommercialTaskInTransaction(tx: Transaction, input: Amounts & { userId: string; taskKey: string; quote: Record<string, unknown> }) {
  validateAmounts(input);
  if (!input.taskKey || input.taskKey.length > 160) throw new Error("Invalid task key");
  // Normalize JSON to compare immutable snapshots independently of object key order.
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",") + "}";
    return JSON.stringify(value);
  };
  const quote = JSON.parse(JSON.stringify(input.quote)) as Record<string, unknown>;
    const wallet = await lockWallet(tx, input.userId);
    const [existing] = await tx.select().from(commercialReservations).where(and(eq(commercialReservations.userId, input.userId), eq(commercialReservations.taskKey, input.taskKey)));
    if (existing) {
      if (existing.credits !== input.credits || existing.rewrites !== input.rewrites || canonical(existing.quote) !== canonical(quote)) throw new Error("Task quote replay mismatch");
      return { reservation: existing, created: false };
    }
    if (wallet.frozen) throw new Error("COMMERCIAL_WALLET_UNDER_REVIEW");
    if (wallet.credits < input.credits || wallet.rewrites < input.rewrites) throw new Error("INSUFFICIENT_COMMERCIAL_BALANCE");
    const [reservation] = await tx.insert(commercialReservations).values({ userId: input.userId, taskKey: input.taskKey, credits: input.credits, rewrites: input.rewrites, quote }).returning();
    const lots = await tx.select().from(commercialLots).where(and(eq(commercialLots.userId, input.userId), eq(commercialLots.state, "active"))).orderBy(asc(commercialLots.createdAt), asc(commercialLots.id)).for("update");
    let creditsLeft = input.credits;
    let rewritesLeft = input.rewrites;
    for (const lot of lots) {
      const credits = Math.min(creditsLeft, lot.availableCredits);
      const rewrites = Math.min(rewritesLeft, lot.availableRewrites);
      if (!credits && !rewrites) continue;
      await tx.insert(commercialAllocations).values({ reservationId: reservation.id, lotId: lot.id, credits, rewrites });
      await tx.update(commercialLots).set({ availableCredits: lot.availableCredits - credits, availableRewrites: lot.availableRewrites - rewrites, heldCredits: lot.heldCredits + credits, heldRewrites: lot.heldRewrites + rewrites }).where(eq(commercialLots.id, lot.id));
      creditsLeft -= credits;
      rewritesLeft -= rewrites;
    }
    if (creditsLeft || rewritesLeft) throw new Error("COMMERCIAL_LOT_RECONCILIATION_REQUIRED");
    await tx.update(commercialWallets).set({
      credits: wallet.credits - input.credits, rewrites: wallet.rewrites - input.rewrites,
      heldCredits: wallet.heldCredits + input.credits, heldRewrites: wallet.heldRewrites + input.rewrites, updatedAt: new Date(),
    }).where(eq(commercialWallets.userId, input.userId));
    return { reservation, created: true };
}

/** Only a confirmed terminal result may settle. Unknown provider status remains held. */
export async function settleCommercialTask(input: Amounts & { userId: string; taskKey: string }) {
  return db.transaction((tx) => settleCommercialTaskInTransaction(tx, input));
}

export async function settleCommercialTaskInTransaction(tx: Transaction, input: Amounts & { userId: string; taskKey: string }) {
  validateAmounts(input);
    const wallet = await lockWallet(tx, input.userId);
    const [reservation] = await tx.select().from(commercialReservations).where(and(eq(commercialReservations.userId, input.userId), eq(commercialReservations.taskKey, input.taskKey))).for("update");
    if (!reservation) throw new Error("Reservation not found");
    if (reservation.state === "settled") {
      if (reservation.settledCredits !== input.credits || reservation.settledRewrites !== input.rewrites) throw new Error("Settlement replay mismatch");
      return { reservation, settled: false };
    }
    if (input.credits > reservation.credits || input.rewrites > reservation.rewrites) throw new Error("Settlement exceeds confirmed quote");
    const allocations = await tx.select({ allocation: commercialAllocations, lot: commercialLots }).from(commercialAllocations)
      .innerJoin(commercialLots, eq(commercialAllocations.lotId, commercialLots.id))
      .where(eq(commercialAllocations.reservationId, reservation.id))
      .orderBy(asc(commercialLots.createdAt), asc(commercialLots.id));
    if (allocations.reduce((n, a) => n + a.allocation.credits, 0) !== reservation.credits || allocations.reduce((n, a) => n + a.allocation.rewrites, 0) !== reservation.rewrites) throw new Error("COMMERCIAL_LOT_RECONCILIATION_REQUIRED");
    let creditsLeft = input.credits;
    let rewritesLeft = input.rewrites;
    for (const { allocation, lot } of allocations) {
      const credits = Math.min(creditsLeft, allocation.credits);
      const rewrites = Math.min(rewritesLeft, allocation.rewrites);
      await tx.update(commercialLots).set({ availableCredits: lot.availableCredits + allocation.credits - credits, availableRewrites: lot.availableRewrites + allocation.rewrites - rewrites, heldCredits: lot.heldCredits - allocation.credits, heldRewrites: lot.heldRewrites - allocation.rewrites, usedCredits: lot.usedCredits + credits, usedRewrites: lot.usedRewrites + rewrites }).where(eq(commercialLots.id, lot.id));
      creditsLeft -= credits;
      rewritesLeft -= rewrites;
    }
    await tx.update(commercialWallets).set({
      credits: wallet.credits + reservation.credits - input.credits,
      rewrites: wallet.rewrites + reservation.rewrites - input.rewrites,
      heldCredits: wallet.heldCredits - reservation.credits,
      heldRewrites: wallet.heldRewrites - reservation.rewrites, updatedAt: new Date(),
    }).where(eq(commercialWallets.userId, input.userId));
    const [updated] = await tx.update(commercialReservations).set({ state: "settled", settledCredits: input.credits, settledRewrites: input.rewrites, updatedAt: new Date() }).where(eq(commercialReservations.id, reservation.id)).returning();
    await tx.insert(commercialLedger).values({ userId: input.userId, eventKey: `settle:${reservation.id}`, credits: -input.credits, rewrites: -input.rewrites, metadata: { reservationId: reservation.id, taskKey: input.taskKey } });
    return { reservation: updated, settled: true };
}
