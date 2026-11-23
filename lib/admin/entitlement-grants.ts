import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, user, commercialLedger, commercialLots, operationLogs } from "@/lib/db";
import { grantCommercialGift } from "@/lib/billing/commercial-wallet";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";

export const giftInput = z.object({
  grantId: z.string().uuid(), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  packageId: z.string().max(60), days: z.number().int().min(1).max(365),
  credits: z.number().int().min(0).max(100000), rewrites: z.number().int().min(0).max(10000),
  linkImports: z.number().int().min(0).max(10000), note: z.string().trim().max(500),
}).strict().superRefine((input, context) => {
  const pack = COMMERCIAL_PACKAGES.find(pack => pack.id === input.packageId);
  if (input.packageId !== "custom" && (!pack || pack.credits !== input.credits || pack.rewrites !== input.rewrites || pack.linkImports !== input.linkImports)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "套餐权益与当前配置不一致，请重新选择" });
  }
  if (!(input.credits || input.rewrites || input.linkImports)) context.addIssue({ code: z.ZodIssueCode.custom, message: "至少发放一项权益" });
});

export async function issueEntitlementGift(input: z.infer<typeof giftInput>, actorId: string) {
  return db.transaction(async tx => {
    const targets = await tx.select({ id: user.id, email: user.email, banned: user.banned, anonymous: user.isAnonymous })
      .from(user).where(sql`lower(${user.email}) = ${input.email}`).limit(2);
    if (targets.length !== 1) throw new Error("GIFT_USER_NOT_FOUND");
    const target = targets[0];
    if (target.banned || target.anonymous) throw new Error("GIFT_USER_UNAVAILABLE");
    const result = await grantCommercialGift(tx, { ...input, userId: target.id, actorId });
    if (result.created) await tx.insert(operationLogs).values({ userId: actorId, action: "admin.credit_grant",
      resourceType: "commercial_gift", resourceId: input.grantId,
      metadata: { targetEmail: target.email, targetUserId: target.id, packageId: input.packageId, credits: input.credits,
        rewrites: input.rewrites, linkImports: input.linkImports, expiresAt: result.expiresAt, note: input.note } });
    return { ...result, email: target.email };
  });
}

export async function listEntitlementGifts() {
  return db.select({ id: commercialLedger.id, email: user.email, credits: commercialLedger.credits,
    rewrites: commercialLedger.rewrites, metadata: commercialLedger.metadata, createdAt: commercialLedger.createdAt,
    expiresAt: commercialLots.expiresAt, state: commercialLots.state,
    availableCredits: commercialLots.availableCredits, availableRewrites: commercialLots.availableRewrites,
  }).from(commercialLedger).innerJoin(user, eq(user.id, commercialLedger.userId))
    .innerJoin(commercialLots, sql`${commercialLots.id}::text = ${commercialLedger.metadata}->>'lotId'`)
    .where(sql`${commercialLedger.metadata}->>'source' = 'admin-gift' AND ${commercialLedger.eventKey} LIKE 'admin-grant:%'`)
    .orderBy(desc(commercialLedger.createdAt)).limit(50);
}
