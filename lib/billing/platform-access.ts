import { and, eq, gt, isNotNull } from "drizzle-orm";
import { isAdmin } from "@/lib/auth";
import { getCreditPackage, type CreditPackageScope } from "@/lib/billing/credit-packages";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { creditLedger, db } from "@/lib/db";

export type KieApiKeySource = "user" | "platform_admin" | "platform_paid";

export type ResolvedKieApiKey = {
  apiKey: string | null;
  source: KieApiKeySource | null;
  hasUserKieKey: boolean;
  hasPaidPackage: boolean;
  isAdmin: boolean;
  platformKeyConfigured: boolean;
};

export function getPlatformKieApiKey() {
  return process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || null;
}

export async function hasPaidPackageAccess(userId: string, requiredScopes: CreditPackageScope[] = []) {
  const rows = await db.query.creditLedger.findMany({
    where: and(eq(creditLedger.userId, userId), isNotNull(creditLedger.packageId), gt(creditLedger.amount, 0)),
  });
  if (!requiredScopes.length) return rows.length > 0;
  return rows.some((row) => {
    const pkg = getCreditPackage(row.packageId);
    return pkg ? requiredScopes.some((scope) => pkg.scopes.includes(scope)) : false;
  });
}

export async function resolveKieApiKeyForFeature(
  userId: string,
  options: { allowPaidPlatformKey?: boolean; requiredPackageScope?: CreditPackageScope } = {},
): Promise<ResolvedKieApiKey> {
  const adminUser = await isAdmin(userId);
  const platformKey = getPlatformKieApiKey();
  const platformKeyConfigured = Boolean(platformKey);

  if (platformKey && adminUser) {
    return {
      apiKey: platformKey,
      source: "platform_admin",
      hasUserKieKey: false,
      hasPaidPackage: true,
      isAdmin: true,
      platformKeyConfigured,
    };
  }

  let userKey: string | null = null;
  try {
    userKey = await getUserKieApiKey(userId);
  } catch (error) {
    if (!adminUser) throw error;
    console.warn("[billing] Failed to load admin BYOK key; continuing with platform/admin access:", error);
  }

  if (userKey) {
    return {
      apiKey: userKey,
      source: "user",
      hasUserKieKey: true,
      hasPaidPackage: false,
      isAdmin: adminUser,
      platformKeyConfigured,
    };
  }

  let hasPaidPackage = false;
  try {
    hasPaidPackage = await hasPaidPackageAccess(userId, options.requiredPackageScope ? [options.requiredPackageScope] : []);
  } catch (error) {
    if (!adminUser) throw error;
    console.warn("[billing] Failed to load paid package access for admin; continuing as admin:", error);
  }

  if (platformKey && hasPaidPackage && options.allowPaidPlatformKey !== false) {
    return {
      apiKey: platformKey,
      source: "platform_paid",
      hasUserKieKey: false,
      hasPaidPackage: true,
      isAdmin: false,
      platformKeyConfigured,
    };
  }

  return {
    apiKey: null,
    source: null,
    hasUserKieKey: false,
    hasPaidPackage,
    isAdmin: adminUser,
    platformKeyConfigured,
  };
}
export function kieAccessError(featureName: string) {
  return {
    error: `${featureName} 需要先在设置里配置你自己的 KIE API Key；如果想使用平台额度，请先购买包含该功能的积分套餐。`,
    code: "KIE_ACCESS_REQUIRED",
  };
}
