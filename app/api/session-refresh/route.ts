import { NextResponse } from "next/server";
import { splitSetCookieHeader } from "better-auth/cookies";
import { auth } from "@/lib/auth";
import { isAccessEmailAllowed, isAccessRestricted } from "@/lib/auth/access-policy";
import { ACCESS_REFRESH_MARKER } from "@/lib/auth/session-cache-access";
import { authReturnPath } from "@/lib/auth/return-path";

export const runtime = "nodejs";

// Fetch callers renew a valid database session without navigating away from a
// running task. The access gate still rejects the original API request first.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  const loadSession = () => auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true }, returnHeaders: true });
  let result: Awaited<ReturnType<typeof loadSession>>;
  try {
    result = await loadSession();
  } catch {
    return NextResponse.json({ code: "SESSION_REFRESH_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const allowed = result?.response?.user && (!isAccessRestricted() || isAccessEmailAllowed(result.response.user.email));
  const response = NextResponse.json(allowed ? { refreshed: true } : { code: "AUTH_REQUIRED" }, {
    status: allowed ? 200 : 401, headers: { "Cache-Control": "private, no-store" },
  });
  copySessionCookies(result?.headers, response);
  return response;
}

function sessionRedirect(destination: URL) {
  return NextResponse.redirect(destination, { headers: { "Cache-Control": "no-store" } });
}

function copySessionCookies(source: Headers | undefined, target: NextResponse) {
  const header = source?.get("set-cookie");
  if (!header) return;
  for (const cookie of splitSetCookieHeader(header)) {
    target.headers.append("set-cookie", cookie);
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = authReturnPath(requestUrl.searchParams.get("next"));

  if (!isAccessRestricted()) {
    return sessionRedirect(new URL(nextPath, request.url));
  }

  const result = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
    returnHeaders: true,
  }).catch(() => null);
  if (!result?.response?.user || !isAccessEmailAllowed(result.response.user.email)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", nextPath);
    loginUrl.searchParams.set("sessionRefreshFailed", "1");
    const response = sessionRedirect(loginUrl);
    copySessionCookies(result?.headers, response);
    return response;
  }

  const destination = new URL(nextPath, request.url);
  destination.searchParams.set(ACCESS_REFRESH_MARKER, "1");
  const response = sessionRedirect(destination);
  copySessionCookies(result.headers, response);
  return response;
}
