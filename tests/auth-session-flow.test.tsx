import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getCookies, splitSetCookieHeader } from "better-auth/cookies";
import { NextRequest } from "next/server";
import { authCookieOptions } from "@/lib/auth/session-cookies";
import { authReturnPath } from "@/lib/auth/return-path";

const getSession = vi.hoisted(() => vi.fn());
const requestHeaders = vi.hoisted(() => vi.fn(() => new Headers()));
const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/app/login/login-client", () => ({ LoginClient: () => null }));

import { middleware } from "@/middleware";
import { GET as refreshSession, POST as refreshFetchSession } from "@/app/api/session-refresh/route";
import { ACCESS_SESSION_REFRESH_REQUIRED } from "@/lib/auth/session-cookies";
import LoginPage from "@/app/login/page";

const secret = "real-cookie-regression-test-secret-32-characters";
const email = "raojiacui@gmail.com";

async function fixture(origin: string, identity = email) {
  const data = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: origin,
    secret,
    database: memoryAdapter(data),
    advanced: authCookieOptions,
    emailAndPassword: { enabled: true }, // Test fixture only; no production auth settings are changed.
    session: { cookieCache: { enabled: true, maxAge: 600 } },
  });
  const signedIn = await auth.api.signUpEmail({
    body: { email: identity, name: "Session fixture", password: "fixture-password-123456" },
    returnHeaders: true,
  });
  const jar = new Map<string, string>();
  const applyCookies = (headers: Headers) => {
    for (const cookie of splitSetCookieHeader(headers.get("set-cookie") || "")) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (/max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
      else jar.set(name, pair.slice(separator + 1));
    }
  };
  applyCookies(signedIn.headers);
  const names = getCookies(auth.options);
  const expireCache = () => {
    for (const name of jar.keys()) if (name === names.sessionData.name || name.startsWith(`${names.sessionData.name}.`)) jar.delete(name);
  };
  const headers = () => new Headers({ cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") });
  getSession.mockImplementation(options => auth.api.getSession(options));
  requestHeaders.mockImplementation(headers);
  return { data, jar, names, applyCookies, expireCache, headers };
}

beforeEach(() => {
  vi.stubEnv("ACCESS_ALLOWED_EMAILS", `${email},raojinbo@gmail.com`);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubGlobal("React", React);
});

afterEach(() => {
  getSession.mockReset();
  requestHeaders.mockReset();
  redirect.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("access redirects with real Better Auth sessions", () => {
  it.each(["http://test.example", "https://test.example"])("renews an API cache from a valid database session without leaving the task on %s", async origin => {
    const f = await fixture(origin);
    f.expireCache();
    const path = "/api/commercial/tasks/11111111-1111-4111-8111-111111111111?diagnostics=1";
    const blocked = await middleware(new NextRequest(`${origin}${path}`, { headers: f.headers() }));
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toMatchObject({ code: ACCESS_SESSION_REFRESH_REQUIRED });
    const headers = f.headers(); headers.set("origin", origin);
    const renewed = await refreshFetchSession(new Request(`${origin}/api/session-refresh`, { method: "POST", headers }));
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get("location")).toBeNull();
    f.applyCookies(renewed.headers);
    expect((await middleware(new NextRequest(`${origin}${path}`, { headers: f.headers() }))).headers.get("x-middleware-next")).toBe("1");
    expect(f.data.session).toHaveLength(1);
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true }, returnHeaders: true }));
  });

  it.each(["revoked", "uninvited", "forged"])("does not renew a %s session for API callers", async kind => {
    const origin = "https://test.example";
    const f = await fixture(origin, kind === "uninvited" ? "someone@example.com" : email);
    f.expireCache();
    if (kind === "revoked") f.data.session.length = 0;
    if (kind === "forged") f.jar.set(f.names.sessionToken.name, "forged-session-token");
    const headers = f.headers(); headers.set("origin", origin);
    const denied = await refreshFetchSession(new Request(`${origin}/api/session-refresh`, { method: "POST", headers }));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ code: "AUTH_REQUIRED" });
  });

  it.each(["http://test.example", "https://test.example"])("restores an expired cache and reaches the original page on %s", async origin => {
    const f = await fixture(origin);
    expect(f.jar.has(f.names.sessionToken.name)).toBe(true);
    expect(f.jar.has(f.names.sessionData.name)).toBe(true);
    f.expireCache();

    const first = await middleware(new NextRequest(`${origin}/dashboard?tab=analyze`, { headers: f.headers() }));
    expect(first.headers.get("location")).toBe(`${origin}/api/session-refresh?next=%2Fdashboard%3Ftab%3Danalyze`);
    const refreshed = await refreshSession(new Request(first.headers.get("location")!, { headers: f.headers() }));
    f.applyCookies(refreshed.headers);
    expect(f.jar.has(f.names.sessionData.name)).toBe(true);

    const marked = await middleware(new NextRequest(refreshed.headers.get("location")!, { headers: f.headers() }));
    expect(marked.headers.get("location")).toBe(`${origin}/dashboard?tab=analyze`);
    const page = await middleware(new NextRequest(marked.headers.get("location")!, { headers: f.headers() }));
    expect(page.status).toBe(200);
    expect(page.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends direct login visits through cookie refresh instead of bouncing to a protected page", async () => {
    const f = await fixture("https://test.example");
    f.expireCache();
    await expect(LoginPage({ searchParams: Promise.resolve({ next: "/dashboard?tab=analyze" }) }))
      .rejects.toThrow("REDIRECT:/api/session-refresh?next=%2Fdashboard%3Ftab%3Danalyze");
  });

  it("stops at login if a browser does not accept the refreshed cache cookie", async () => {
    const f = await fixture("https://test.example");
    f.expireCache();
    const refreshed = await refreshSession(new Request("https://test.example/api/session-refresh?next=%2Fdashboard", { headers: f.headers() }));
    // Deliberately do not apply Set-Cookie, reproducing rejected or lost refresh cookies.
    const stopped = await middleware(new NextRequest(refreshed.headers.get("location")!, { headers: f.headers() }));
    const login = new URL(stopped.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("sessionRefreshFailed")).toBe("1");
    const page = await LoginPage({ searchParams: Promise.resolve(Object.fromEntries(login.searchParams)) });
    expect(page.props.suppressSessionRedirect).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns expired database sessions to a stable login page", async () => {
    const f = await fixture("https://test.example");
    f.expireCache();
    f.data.session.length = 0;
    const refreshed = await refreshSession(new Request("https://test.example/api/session-refresh?next=%2Fdashboard", { headers: f.headers() }));
    const login = new URL(refreshed.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("sessionRefreshFailed")).toBe("1");
    f.applyCookies(refreshed.headers);
    const page = await LoginPage({ searchParams: Promise.resolve(Object.fromEntries(login.searchParams)) });
    expect(page.props.suppressSessionRedirect).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["/login", "/login?next=/login", "/api/session-refresh?next=/login", "/x/../login", "/\\evil.example"])("rejects a return path that can restart the auth loop: %s", path => {
    expect(authReturnPath(path)).toBe("/dashboard");
  });
});
