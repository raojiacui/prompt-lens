export const USER_PROVIDERS = ["infistar", "kie"] as const;
export type UserProvider = (typeof USER_PROVIDERS)[number];

export const INFISTAR_REGISTRATION_URL = "https://www.infistar.cc/register?aff=PROMPTLENS&ref_source=link";
export const MODEL_VERIFICATION_URL = "https://mozhenzhen.com/go/prompt-lens";

export function isUserProvider(value: unknown): value is UserProvider {
  return value === "infistar" || value === "kie";
}

export function providerName(provider: string, locale?: string) {
  return provider === "infistar" ? (locale === "zh" ? "无限星河 Infistar" : "Infistar") : provider === "kie" ? "KIE" : provider;
}
