import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import { authCookieOptions } from "./session-cookies";

type CachedSession = {
  session?: { expiresAt?: unknown };
  user?: { email?: unknown };
};

export type AccessSessionState = {
  email: string | null;
  hasSessionToken: boolean;
};

export const ACCESS_REFRESH_MARKER = "__pl_access_refreshed";

function cachedSessionIsExpired(cache: CachedSession) {
  const expiresAt = cache.session?.expiresAt;
  if (!(expiresAt instanceof Date) && typeof expiresAt !== "string" && typeof expiresAt !== "number") {
    return true;
  }
  const timestamp = new Date(expiresAt).getTime();
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

export async function verifiedCachedSessionEmail(
  request: Request | Headers,
  secret: string,
): Promise<string | null> {
  // Better Auth chooses the secure cookie name from the runtime environment.
  // Checking both names keeps local HTTPS tests and production requests aligned.
  const secureCache = await getCookieCache(request, {
    ...authCookieOptions,
    secret,
    isSecure: true,
  }).catch(() => null);
  const cache = secureCache ?? await getCookieCache(request, {
    ...authCookieOptions,
    secret,
    isSecure: false,
  }).catch(() => null);

  if (!cache || cachedSessionIsExpired(cache)) return null;
  const email = cache.user?.email;
  return typeof email === "string" ? email : null;
}

export async function inspectAccessSession(
  request: Request,
  secret: string | undefined,
): Promise<AccessSessionState> {
  const sessionToken = getSessionCookie(request, authCookieOptions);
  const email = secret
    ? await verifiedCachedSessionEmail(request, secret)
    : null;

  return {
    email,
    hasSessionToken: Boolean(sessionToken),
  };
}
