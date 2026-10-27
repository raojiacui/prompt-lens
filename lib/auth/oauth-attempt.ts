import { createHash } from "node:crypto";
import { getAuthBaseURL } from "./origin";

type AuthHandler = (request: Request) => Promise<Response>;
const MAX_PENDING_ATTEMPTS = 3;
const RECOVERABLE_ERRORS = new Set(["state_mismatch", "please_restart_the_process", "state_not_found"]);

function attemptCookieName(base: string, state: string) {
  return `${base}.${createHash("sha256").update(state).digest("hex").slice(0, 32)}`;
}

function requestCookies(request: Request) {
  return (request.headers.get("cookie") || "").split(";").flatMap(part => {
    const separator = part.indexOf("=");
    return separator < 1 ? [] : [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()] as const];
  });
}

function privateResponse(response: Response, cookies = response.headers.getSetCookie()) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function restartLogin(request: Request) {
  // An absent/used/expired state is never enough to exchange a code or create a session.
  return privateResponse(Response.redirect(new URL("/login?error=oauth_state", getAuthBaseURL() || request.url), 303));
}

function isAttemptCookie(name: string, base: string) {
  return name.startsWith(`${base}.`) && /^[a-f0-9]{32}$/.test(name.slice(base.length + 1));
}

export function withOAuthAttemptState(handler: AuthHandler, getStateCookieName: () => Promise<string>): AuthHandler {
  return async request => {
    const url = new URL(request.url);
    const callback = request.method === "GET" && /^\/api\/auth\/callback\/(google|github)\/?$/.exec(url.pathname);
    const start = request.method === "POST" && url.pathname.replace(/\/$/, "") === "/api/auth/sign-in/social";
    if (!callback && !start) return handler(request);

    const base = await getStateCookieName();
    const cookies = requestCookies(request);
    if (callback) {
      const states = url.searchParams.getAll("state");
      const state = states.length === 1 ? states[0] : "";
      if (!state || state.length > 512) return restartLogin(request);
      const name = attemptCookieName(base, state);
      const attempt = cookies.find(([key, value]) => key === name && value);
      const legacy = cookies.find(([key, value]) => key === base && value);
      if (!attempt && !legacy) {
        console.warn("auth.oauth.restart_required", { provider: callback[1], reason: "state_cookie_missing" });
        return restartLogin(request);
      }

      // Present only this attempt's encrypted value under Better Auth's expected name.
      // Better Auth still decrypts it and verifies the nonce, expiry and PKCE normally.
      let callbackRequest = request;
      if (attempt) {
        const headers = new Headers(request.headers);
        headers.set("cookie", [...cookies.filter(([key]) => key !== base), [base, attempt[1]]].map(([key, value]) => `${key}=${value}`).join("; "));
        // Next.js wraps incoming requests in a proxy; cloning that object can
        // trigger native Request private-field errors. Callbacks here are GETs.
        callbackRequest = new Request(request.url, { method: "GET", headers });
      }
      const response = await handler(callbackRequest);
      const scopedCookies = response.headers.getSetCookie().map(cookie => attempt && cookie.startsWith(`${base}=`) ? `${name}${cookie.slice(base.length)}` : cookie);
      const location = response.headers.get("location");
      if (location) {
        const destination = new URL(location, request.url);
        if (destination.origin === (getAuthBaseURL() || url.origin) && RECOVERABLE_ERRORS.has(destination.searchParams.get("error") || "")) {
          const recovery = restartLogin(request);
          return privateResponse(recovery, scopedCookies);
        }
      }
      return privateResponse(response, scopedCookies);
    }

    const response = await handler(request);
    const setCookies = response.headers.getSetCookie();
    const stateCookie = setCookies.find(cookie => cookie.startsWith(`${base}=`) && !/;\s*Max-Age=0(?:;|$)/i.test(cookie));
    if (!stateCookie || response.status >= 400) return privateResponse(response);
    const body = await response.clone().json().catch(() => null);
    const providerURL = response.headers.get("location") || body?.url;
    let state: string | null = null;
    try { state = new URL(providerURL).searchParams.get("state"); } catch { /* No redirect-based OAuth state. */ }
    if (!state || state.length > 512) throw new Error("OAuth redirect is missing its state binding");
    const name = attemptCookieName(base, state);
    const scopedCookies = setCookies.map(cookie => cookie === stateCookie ? `${name}${cookie.slice(base.length)}` : cookie);
    // Keep a small, bounded number of tabs without accumulating request-header-sized cookies.
    const pending = cookies.filter(([key]) => isAttemptCookie(key, base) && key !== name);
    for (const [oldName] of pending.slice(0, Math.max(0, pending.length - MAX_PENDING_ATTEMPTS + 1))) {
      scopedCookies.push(stateCookie.replace(/^[^;]+/, `${oldName}=`).replace(/;\s*Max-Age=[^;]*/i, "; Max-Age=0"));
    }
    return privateResponse(response, scopedCookies);
  };
}
