import { and, eq, gt, isNotNull } from "drizzle-orm";
import { isAdmin } from "@/lib/auth";
import { getCreditPackage, type CreditPackageScope } from "@/lib/billing/credit-packages";
import { getUserCredential, type UserCredential } from "@/lib/byok/credentials";
import type { UserProvider } from "@/lib/ai/providers";
import { creditLedger, db } from "@/lib/db";

export type ApiKeySource = "user" | "platform_admin" | "platform_paid";

export type ResolvedApiKey = {
  apiKey: string | null;
  provider: UserProvider;
  source: ApiKeySource | null;
  hasUserApiKey: boolean;
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

export async function resolveApiKeyForFeature(
  userId: string,
  options: { allowPaidPlatformKey?: boolean; requiredPackageScope?: CreditPackageScope } = {},
): Promise<ResolvedApiKey> {
  const adminUser = await isAdmin(userId);
  const platformKey = getPlatformKieApiKey();
  const platformKeyConfigured = Boolean(platformKey);

  let credential: UserCredential | null = null;
  try {
    credential = await getUserCredential(userId);
  } catch (error) {
    if (!adminUser) throw error;
    console.warn("[billing] Failed to load admin BYOK key; continuing with platform/admin access:", error);
  }

  if (credential) {
    return {
      apiKey: credential.apiKey,
      provider: credential.provider,
      source: "user",
      hasUserApiKey: true,
      hasPaidPackage: false,
      isAdmin: adminUser,
      platformKeyConfigured,
    };
  }

  if (platformKey && adminUser) {
    return {
      apiKey: platformKey,
      provider: "kie",
      source: "platform_admin",
      hasUserApiKey: false,
      hasPaidPackage: true,
      isAdmin: true,
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

  if (platformKey && hasPaidPackage && options.allowPaidPlatformKey === true) {
    return {
      apiKey: platformKey,
      provider: "kie",
      source: "platform_paid",
      hasUserApiKey: false,
      hasPaidPackage: true,
      isAdmin: false,
      platformKeyConfigured,
    };
  }

  return {
    apiKey: null,
    provider: "kie",
    source: null,
    hasUserApiKey: false,
    hasPaidPackage,
    isAdmin: adminUser,
    platformKeyConfigured,
  };
}
export function providerAccessError(featureName: string) {
  return {
    error: `${featureName} 需要先在设置里配置你自己的 Infistar 或 KIE API Key；如果想使用平台额度，请先购买包含该功能的积分套餐。`,
    code: "KIE_ACCESS_REQUIRED",
  };
}
