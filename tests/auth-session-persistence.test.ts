import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withOAuthAttemptState } from "@/lib/auth/oauth-attempt";

// Exercise the real authentication handlers with an isolated in-memory database.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => undefined }));

const origin = "https://prompt-lens.example";
const day = 24 * 60 * 60 * 1000;
const startedAt = new Date("2026-10-19T00:00:00Z");
let auth: typeof import("@/lib/auth").auth;
let protectedHandler: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-session-persistence-secret-at-least-32-chars");
  vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_URL", origin);
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
  vi.stubEnv("NEXT_PUBLIC_GITHUB_CLIENT_ID", "test-github-client-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "test-github-client-secret");
  vi.stubEnv("ADMIN_EMAILS", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  ({ auth } = await import("@/lib/auth"));
  protectedHandler = withOAuthAttemptState(auth.handler, async () => (await auth.$context).createAuthCookie("oauth_state").name);
});

beforeEach(() => vi.setSystemTime(startedAt));
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function createSession() {
  // Anonymous and OAuth sign-ins use the same session store and cookie writer.
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: "{}",
  }));
  expect(response.status).toBe(200);
  const cookies = response.headers.getSetCookie();
  const tokenCookie = cookies.find((cookie) => cookie.startsWith("__Secure-better-auth.session_token="));
  expect(tokenCookie).toBeDefined();
  const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  return { response, tokenCookie: tokenCookie!, cookie, body: await response.json() };
}

async function getSession(cookie: string) {
  return auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }));
}

describe("remembered authentication sessions", () => {
  it("issues a persistent 30-day cookie with the production security attributes", async () => {
    const { tokenCookie, body } = await createSession();
    expect(tokenCookie).toMatch(/Max-Age=2592000/i);
    expect(tokenCookie).toMatch(/HttpOnly/i);
    expect(tokenCookie).toMatch(/; Secure(?:;|$)/i);
    expect(tokenCookie).toMatch(/SameSite=Lax/i);
    expect(tokenCookie).toMatch(/Path=\//i);
    const context = await auth.$context;
    const session = await context.internalAdapter.findSession(body.token);
    expect(new Date(session!.session.expiresAt).getTime()).toBe(startedAt.getTime() + 30 * day);
  });

  it("restores a session using only the persistent token after the short cookie cache expires", async () => {
    const { tokenCookie, body } = await createSession();
    vi.setSystemTime(new Date(startedAt.getTime() + 60 * 60 * 1000));
    const response = await getSession(tokenCookie.split(";")[0]);
    expect(response.status).toBe(200);
    expect((await response.json()).user.id).toBe(body.user.id);
  });

  it("recognizes a session while the short cookie cache is still valid", async () => {
    const { cookie, body } = await createSession();
    expect((await (await getSession(cookie)).json()).user.id).toBe(body.user.id);
  });

  it("renews the cookie and database expiry after a day of active use", async () => {
    const { tokenCookie } = await createSession();
    vi.setSystemTime(new Date(startedAt.getTime() + 2 * day));
    const response = await getSession(tokenCookie.split(";")[0]);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((value) =>
      value.startsWith("__Secure-better-auth.session_token=") && /Max-Age=2592000/i.test(value),
    )).toBe(true);
    const body = await response.json();
    expect(new Date(body.session.expiresAt).getTime()).toBe(startedAt.getTime() + 32 * day);
  });

  it("rejects an expired persistent session", async () => {
    const { tokenCookie } = await createSession();
    vi.setSystemTime(new Date(startedAt.getTime() + 31 * day));
    expect(await (await getSession(tokenCookie.split(";")[0])).json()).toBeNull();
  });

  it("clears the persistent cookie and revokes the database session on explicit logout", async () => {
    const { cookie, tokenCookie } = await createSession();
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((value) =>
      value.startsWith("__Secure-better-auth.session_token=") && /Max-Age=0/i.test(value),
    )).toBe(true);
    expect(await (await getSession(tokenCookie.split(";")[0])).json()).toBeNull();
  });
});

describe("OAuth state persistence", () => {
  it("round-trips the encrypted state cookie through a provider callback", async () => {
    const signInResponse = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/dashboard" }),
    }));
    expect(signInResponse.status).toBe(200);

    const body = await signInResponse.json();
    const providerURL = new URL(body.url);
    const state = providerURL.searchParams.get("state");
    expect(state).toBeTruthy();

    const stateCookie = signInResponse.headers.getSetCookie().find((value) =>
      value.startsWith("__Secure-better-auth.oauth_state="),
    );
    expect(stateCookie).toMatch(/Max-Age=600/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(stateCookie).toMatch(/; Secure(?:;|$)/i);

    const callbackResponse = await auth.handler(new Request(
      `${origin}/api/auth/callback/google?state=${encodeURIComponent(state!)}&error=access_denied`,
      { headers: { cookie: stateCookie!.split(";")[0] } },
    ));
    expect(callbackResponse.status).toBeGreaterThanOrEqual(300);
    expect(callbackResponse.status).toBeLessThan(400);
    expect(callbackResponse.headers.get("location")).not.toContain("state_mismatch");
  });
});

function applyCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const name = pair.slice(0, pair.indexOf("="));
    if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name);
    else jar.set(name, pair.slice(pair.indexOf("=") + 1));
  }
}
const headerCookies = (jar: Map<string, string>) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
async function beginOAuth(provider: "google" | "github", jar: Map<string, string>, handler = protectedHandler) {
  const response = await handler(new Request(`${origin}/api/auth/sign-in/social`, {
    method: "POST", headers: { origin, cookie: headerCookies(jar), "Content-Type": "application/json" },
    body: JSON.stringify({ provider, callbackURL: "/dashboard", errorCallbackURL: "/login" }),
  }));
  expect(response.status).toBe(200);
  applyCookies(jar, response);
  const body = await response.json();
  return { response, state: new URL(body.url).searchParams.get("state")! };
}
const callbackRequest = (provider: string, state: string, jar: Map<string, string>, result = "error=access_denied") => new Request(
  `${origin}/api/auth/callback/${provider}?state=${encodeURIComponent(state)}&${result}`, { headers: { cookie: headerCookies(jar) } },
);

describe("isolated OAuth attempts", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real OAuth provider requests are disabled in this regression test"));
  });
  it("reproduces the shared-cookie overwrite and missing-cookie failure in the original handler", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const jar = new Map<string, string>();
    const first = await beginOAuth("google", jar, auth.handler);
    const second = await beginOAuth("github", jar, auth.handler);
    expect(jar.size).toBe(1);
    const mismatch = await auth.handler(callbackRequest("google", first.state, jar));
    expect(mismatch.headers.get("location")).toContain("state_mismatch");
    const used = await auth.handler(callbackRequest("github", second.state, jar));
    applyCookies(jar, used);
    const missing = await auth.handler(callbackRequest("google", first.state, jar));
    expect(missing.headers.get("location")).toContain("please_restart_the_process");
    expect(error.mock.calls.flat().map(String).join(" ")).toContain("auth state cookie not found");
  });

  it.each([["google", "github"], ["github", "google"], ["github", "github"]] as const)("keeps concurrent %s and %s attempts independent", async (firstProvider, secondProvider) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const jar = new Map<string, string>();
    const first = await beginOAuth(firstProvider, jar);
    const second = await beginOAuth(secondProvider, jar);
    expect(jar.size).toBe(2);
    for (const response of [first.response, second.response]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.getSetCookie()[0]).toMatch(/^__Secure-better-auth\.oauth_state\.[a-f0-9]{32}=/);
      expect(response.headers.getSetCookie()[0]).toMatch(/HttpOnly/);
      expect(response.headers.getSetCookie()[0]).toMatch(/SameSite=Lax/);
      expect(response.headers.getSetCookie()[0]).toMatch(/; Secure(?:;|$)/);
      expect(response.headers.getSetCookie()[0]).toMatch(/Max-Age=600/);
    }
    const secondCallback = await protectedHandler(callbackRequest(secondProvider, second.state, jar));
    expect(secondCallback.headers.get("location")).toContain("access_denied");
    applyCookies(jar, secondCallback);
    expect(jar.size).toBe(1);
    const firstCallback = await protectedHandler(callbackRequest(firstProvider, first.state, jar));
    expect(firstCallback.headers.get("location")).toContain("access_denied");
    applyCookies(jar, firstCallback);
    expect(jar.size).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("creates a real session only after state and the mocked provider authorization both succeed", async () => {
    const context = await auth.$context;
    const provider = context.socialProviders.find(provider => provider.id === "google")!;
    const validateCode = vi.spyOn(provider, "validateAuthorizationCode").mockResolvedValue({ accessToken: "test-access-token", scopes: ["email"] });
    vi.spyOn(provider, "getUserInfo").mockResolvedValue({ user: { id: "test-oauth-google-user", name: "OAuth Test", email: "oauth@example.test", emailVerified: true }, data: {} });
    const jar = new Map<string, string>();
    const start = await beginOAuth("google", jar);
    const response = await protectedHandler(callbackRequest("google", start.state, jar, "code=test-code"));
    expect(new URL(response.headers.get("location")!, origin).toString()).toBe(`${origin}/dashboard`);
    expect(validateCode).toHaveBeenCalledWith(expect.objectContaining({ code: "test-code", codeVerifier: expect.any(String) }));
    expect(validateCode.mock.calls[0][0].codeVerifier).toHaveLength(128);
    applyCookies(jar, response);
    const session = await (await getSession(headerCookies(jar))).json();
    expect(session.user).toMatchObject({ email: "oauth@example.test", isAnonymous: false });
  });

  it("returns missing and reused callbacks to the login page without exchanging codes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = await auth.$context;
    const validateCode = vi.spyOn(context.socialProviders.find(provider => provider.id === "github")!, "validateAuthorizationCode");
    const jar = new Map<string, string>();
    const start = await beginOAuth("github", jar);
    const callback = await protectedHandler(callbackRequest("github", start.state, jar));
    applyCookies(jar, callback);
    const replay = await protectedHandler(callbackRequest("github", start.state, jar, "code=must-not-exchange"));
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe(`${origin}/login?error=oauth_state`);
    expect(replay.headers.getSetCookie()).toHaveLength(0);
    expect(validateCode).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("auth.oauth.restart_required", { provider: "github", reason: "state_cookie_missing" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(start.state);
  });

  it("uses the configured origin when Next supplies an internal callback hostname", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await protectedHandler(new Request("http://localhost:4602/api/auth/callback/github?state=used&code=must-not-exchange"));
    expect(response.headers.get("location")).toBe(`${origin}/login?error=oauth_state`);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("preserves state verification when an encrypted value is moved under another attempt name", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = (await auth.$context).socialProviders.find(provider => provider.id === "google")!;
    const validateCode = vi.spyOn(provider, "validateAuthorizationCode");
    const jar = new Map<string, string>();
    const first = await beginOAuth("google", jar);
    const firstName = [...jar.keys()][0];
    await beginOAuth("github", jar);
    jar.set(firstName, [...jar.values()][1]);
    const response = await protectedHandler(callbackRequest("google", first.state, jar, "code=must-not-exchange"));
    expect(response.headers.get("location")).toBe(`${origin}/login?error=oauth_state`);
    expect(response.headers.getSetCookie().some(cookie => cookie.includes("session_token="))).toBe(false);
    expect(validateCode).not.toHaveBeenCalled();
  });

  it("rejects an expired encrypted cookie even if it is still presented", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = (await auth.$context).socialProviders.find(provider => provider.id === "github")!;
    const validateCode = vi.spyOn(provider, "validateAuthorizationCode");
    const jar = new Map<string, string>();
    const start = await beginOAuth("github", jar);
    vi.setSystemTime(new Date(startedAt.getTime() + 601_000));
    const response = await protectedHandler(callbackRequest("github", start.state, jar, "code=must-not-exchange"));
    expect(response.headers.get("location")).toBe(`${origin}/login?error=oauth_state`);
    expect(response.headers.getSetCookie().some(cookie => cookie.includes("session_token="))).toBe(false);
    expect(validateCode).not.toHaveBeenCalled();
  });

  it("supports pending legacy cookies issued before the deployment", async () => {
    const jar = new Map<string, string>();
    const start = await beginOAuth("google", jar, auth.handler);
    const response = await protectedHandler(callbackRequest("google", start.state, jar));
    expect(response.headers.get("location")).toContain("access_denied");
    applyCookies(jar, response);
    expect(jar.size).toBe(0);
  });

  it("bounds pending attempts and preserves the latest three", async () => {
    const jar = new Map<string, string>();
    const starts = [];
    for (let i = 0; i < 5; i++) starts.push(await beginOAuth("github", jar));
    expect(jar.size).toBe(3);
    for (const start of starts.slice(-3)) {
      const response = await protectedHandler(callbackRequest("github", start.state, jar));
      expect(response.headers.get("location")).toContain("access_denied");
      applyCookies(jar, response);
    }
    expect(jar.size).toBe(0);
  });
});
