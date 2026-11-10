export const USER_PROVIDERS = ["infistar", "kie"] as const;
export type UserProvider = (typeof USER_PROVIDERS)[number];

export const INFISTAR_REGISTRATION_URL = "https://www.infistar.cc/register?aff=PROMPTLENS&ref_source=link";
export const MODEL_VERIFICATION_URL = "https://mozhenzhen.com/go/prompt-lens";
export const INFISTAR_ANNOUNCEMENT_COOKIE = "promptlens-infistar-announcement-v1";

export function isUserProvider(value: unknown): value is UserProvider {
  return value === "infistar" || value === "kie";
}

export function providerName(provider: string) {
  return provider === "infistar" ? "Infistar" : provider === "kie" ? "KIE" : provider;
}
