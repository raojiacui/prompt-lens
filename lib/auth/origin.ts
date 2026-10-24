export const DEFAULT_PRODUCTION_ORIGIN = "https://prompt-lens.cc.cd";

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function getAuthBaseURL(
  environment: AuthEnvironment = process.env,
): string | undefined {
  if (environment.VERCEL_ENV === "production") {
    return DEFAULT_PRODUCTION_ORIGIN;
  }

  const configured = [
    environment.BETTER_AUTH_URL,
    environment.NEXT_PUBLIC_BETTER_AUTH_URL,
    environment.NEXT_PUBLIC_SITE_URL,
  ].map(normalizeOrigin).find(Boolean);

  if (configured) return configured;
  return undefined;
}

export function getCanonicalProductionRedirect(
  requestURL: URL,
  environment: AuthEnvironment = process.env,
): URL | null {
  if (environment.VERCEL_ENV !== "production") return null;

  const canonicalOrigin = getAuthBaseURL(environment);
  if (!canonicalOrigin || requestURL.origin === canonicalOrigin) return null;

  return new URL(`${requestURL.pathname}${requestURL.search}`, canonicalOrigin);
}
