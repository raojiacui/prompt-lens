import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { creditLedger, db, user, userCredits } from "@/lib/db";
import { getCreditPackage } from "@/lib/billing/credit-packages";

export type CreditLedgerType = "manual_grant" | "payment_grant" | "feature_usage" | "refund_revoke" | "admin_adjustment";

export type GrantCreditsInput = {
  targetUserId: string;
  actorUserId?: string | null;
  amount: number;
  type?: Extract<CreditLedgerType, "manual_grant" | "payment_grant" | "admin_adjustment">;
  packageId?: string | null;
  paymentProvider?: string | null;
  paymentReference?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
};

export function normalizeCreditAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const normalized = Math.floor(amount);
  return normalized > 0 ? normalized : null;
}

export async function findUserForCreditGrant(params: { userId?: string | null; email?: string | null }) {
  const email = params.email?.trim().toLowerCase();
  if (params.userId) {
    return db.query.user.findFirst({ where: eq(user.id, params.userId) });
  }
  if (email) {
    return db.query.user.findFirst({ where: eq(user.email, email) });
  }
  return null;
}

export async function getCreditBalance(userId: string) {
  const row = await db.query.userCredits.findFirst({ where: eq(userCredits.userId, userId) });
  return row || { userId, balance: 0, lifetimeGranted: 0, lifetimeUsed: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
}

export async function getCreditBalancesForUsers(userIds: string[]) {
  if (!userIds.length) return new Map<string, number>();
  const rows = await db
    .select({ userId: userCredits.userId, balance: userCredits.balance })
    .from(userCredits)
    .where(inArray(userCredits.userId, userIds));
  return new Map(rows.map((row) => [row.userId, row.balance]));
}

export async function getRecentCreditLedger(userId: string, limit = 20) {
  return db.query.creditLedger.findMany({
    where: eq(creditLedger.userId, userId),
    orderBy: [desc(creditLedger.createdAt)],
    limit,
  });
}

export async function grantCreditsToUser(input: GrantCreditsInput) {
  const amount = normalizeCreditAmount(input.amount);
  if (!amount) throw new Error("积分数量必须是大于 0 的整数");

  const packageConfig = getCreditPackage(input.packageId);
  const metadata = {
    ...(input.metadata || {}),
    ...(packageConfig ? { packageName: packageConfig.name, packagePriceCny: packageConfig.priceCny } : {}),
  };

  return db.transaction(async (tx) => {
    const [balanceRow] = await tx
      .insert(userCredits)
      .values({
        userId: input.targetUserId,
        balance: amount,
        lifetimeGranted: amount,
        metadata,
      })
      .onConflictDoUpdate({
        target: userCredits.userId,
        set: {
          balance: sql`${userCredits.balance} + ${amount}`,
          lifetimeGranted: sql`${userCredits.lifetimeGranted} + ${amount}`,
          metadata: sql`${userCredits.metadata} || ${JSON.stringify(metadata)}::jsonb`,
          updatedAt: new Date(),
        },
      })
      .returning();

    await tx.insert(creditLedger).values({
      userId: input.targetUserId,
      actorUserId: input.actorUserId || null,
      amount,
      balanceAfter: balanceRow.balance,
      type: input.type || "manual_grant",
      packageId: input.packageId || null,
      paymentProvider: input.paymentProvider || null,
      paymentReference: input.paymentReference || null,
      note: input.note || null,
      metadata,
    });

    return balanceRow;
  });
}
export class InsufficientCreditsError extends Error {
  status = 402;
  required: number;
  balance: number;

  constructor(required: number, balance: number) {
    super(`积分不足：本次需要 ${required} 积分，当前余额 ${balance}。`);
    this.name = "InsufficientCreditsError";
    this.required = required;
    this.balance = balance;
  }
}

export async function assertHasCredits(userId: string, requiredAmount: number) {
  const amount = normalizeCreditAmount(requiredAmount);
  if (!amount) throw new Error("积分数量必须是大于 0 的整数");
  const balance = await getCreditBalance(userId);
  if (balance.balance < amount) throw new InsufficientCreditsError(amount, balance.balance);
  return balance;
}

export async function deductCreditsFromUser(input: {
  userId: string;
  amount: number;
  type?: Extract<CreditLedgerType, "feature_usage" | "refund_revoke" | "admin_adjustment">;
  note?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const amount = normalizeCreditAmount(input.amount);
  if (!amount) throw new Error("积分数量必须是大于 0 的整数");

  return db.transaction(async (tx) => {
    await tx
      .insert(userCredits)
      .values({ userId: input.userId, balance: 0, lifetimeGranted: 0, lifetimeUsed: 0 })
      .onConflictDoNothing({ target: userCredits.userId });

    const [balanceRow] = await tx
      .update(userCredits)
      .set({
        balance: sql`${userCredits.balance} - ${amount}`,
        lifetimeUsed: sql`${userCredits.lifetimeUsed} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(and(eq(userCredits.userId, input.userId), gte(userCredits.balance, amount)))
      .returning();

    if (!balanceRow) {
      const current = await tx.query.userCredits.findFirst({ where: eq(userCredits.userId, input.userId) });
      throw new InsufficientCreditsError(amount, current?.balance || 0);
    }

    await tx.insert(creditLedger).values({
      userId: input.userId,
      amount: -amount,
      balanceAfter: balanceRow.balance,
      type: input.type || "feature_usage",
      note: input.note || null,
      metadata: input.metadata || {},
    });

    return balanceRow;
  });
}

export function creditErrorResponse(error: unknown) {
  if (!(error instanceof InsufficientCreditsError)) return null;
  return {
    error: error.message,
    code: "INSUFFICIENT_CREDITS",
    required: error.required,
    balance: error.balance,
  };
}