import { eq } from "drizzle-orm";
import { commercialWallets, db } from "@/lib/db";

// Enable only after 0010 is applied and the rewrite integration is accepted.
export function commercialRewriteEnabled() {
  return process.env.COMMERCIAL_REWRITE_ENABLED === "true";
}

export async function getCommercialRewriteBalance(userId: string) {
  if (!commercialRewriteEnabled() && process.env.COMMERCIAL_CONSUMPTION_ENABLED !== "true") return { enabled: false as const };
  const [wallet] = await db.select().from(commercialWallets).where(eq(commercialWallets.userId, userId));
  return { enabled: commercialRewriteEnabled(), frozen: wallet?.frozen ?? false, credits: wallet?.credits ?? 0, rewrites: wallet?.rewrites ?? 0, heldCredits: wallet?.heldCredits ?? 0, heldRewrites: wallet?.heldRewrites ?? 0 };
}
