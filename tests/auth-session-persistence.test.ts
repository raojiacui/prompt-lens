import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real authentication handlers with an isolated in-memory database.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => undefined }));

const origin = "https://prompt-lens.example";
const day = 24 * 60 * 60 * 1000;
const startedAt = new Date("2026-10-19T00:00:00Z");
let auth: typeof import("@/lib/auth").auth;

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
});

beforeEach(() => vi.setSystemTime(startedAt));
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
