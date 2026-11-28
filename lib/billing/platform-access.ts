import { and, eq, gt, isNotNull } from "drizzle-orm";
import { getCreditPackage, type CreditPackageScope } from "@/lib/billing/credit-packages";
import { getUserCredential } from "@/lib/byok/credentials";
import type { UserProvider } from "@/lib/ai/providers";
import { creditLedger, db } from "@/lib/db";

export type ApiKeySource = "user" | "platform_paid";

export type ResolvedApiKey = {
  apiKey: string | null;
  provider: UserProvider;
  source: ApiKeySource | null;
  hasUserApiKey: boolean;
  hasPaidPackage: boolean;
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
  const platformKey = getPlatformKieApiKey();
  const platformKeyConfigured = Boolean(platformKey);

  const credential = await getUserCredential(userId);

  if (credential) {
    return {
      apiKey: credential.apiKey,
      provider: credential.provider,
      source: "user",
      hasUserApiKey: true,
      hasPaidPackage: false,
      platformKeyConfigured,
    };
  }

  const hasPaidPackage = await hasPaidPackageAccess(userId, options.requiredPackageScope ? [options.requiredPackageScope] : []);

  if (platformKey && hasPaidPackage && options.allowPaidPlatformKey === true) {
    return {
      apiKey: platformKey,
      provider: "kie",
      source: "platform_paid",
      hasUserApiKey: false,
      hasPaidPackage: true,
      platformKeyConfigured,
    };
  }

  return {
    apiKey: null,
    provider: "kie",
    source: null,
    hasUserApiKey: false,
    hasPaidPackage,
    platformKeyConfigured,
  };
}
export function providerAccessError(featureName: string) {
  return {
    error: `${featureName} 需要先在设置里配置你自己的 Infistar 或 KIE API Key；如果想使用平台额度，请先购买包含该功能的积分套餐。`,
    code: "KIE_ACCESS_REQUIRED",
  };
}
