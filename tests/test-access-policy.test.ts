import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { getCookies } from "better-auth/cookies";
import { authCookieOptions } from "@/lib/auth/session-cookies";
import {
  configuredAccessEmails,
  isAccessEmailAllowed,
  isAccessRestricted,
} from "@/lib/auth/access-policy";
import { verifiedCachedSessionEmail } from "@/lib/auth/session-cache-access";
import { middleware } from "@/middleware";

const previousAllowedEmails = process.env.ACCESS_ALLOWED_EMAILS;
const previousAuthSecret = process.env.BETTER_AUTH_SECRET;

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function signedSessionCookie(email: string, secret: string) {
  const now = new Date().toISOString();
  const session = {
    session: {
      id: "session-1",
      userId: "user-1",
      token: "token-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: "user-1",
      email,
      emailVerified: true,
      name: "Test User",
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    updatedAt: Date.now(),
    version: "1",
  };
  const expiresAt = Date.now() + 60_000;
  const signature = createHmac("sha256", secret)
    .update(JSON.stringify({ ...session, expiresAt }))
    .digest("base64url");
  return encodeBase64Url(JSON.stringify({
    session,
    expiresAt,
    signature,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  if (previousAllowedEmails === undefined) delete process.env.ACCESS_ALLOWED_EMAILS;
  else process.env.ACCESS_ALLOWED_EMAILS = previousAllowedEmails;
  if (previousAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousAuthSecret;
});

describe("V2 test access policy", () => {
  it("only challenges an API cache when a session token exists", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com,raojinbo@gmail.com";
    const url = "https://test.example/api/commercial/tasks/task";
    const anonymous = await middleware(new NextRequest(url));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).not.toHaveProperty("code");
    const tokenOnly = await middleware(new NextRequest(url, { headers: { cookie: "__Secure-better-auth.session_token=requires-server-verification" } }));
    expect(tokenOnly.status).toBe(401);
    expect(await tokenOnly.json()).toHaveProperty("code", "ACCESS_SESSION_REFRESH_REQUIRED");
    expect(tokenOnly.headers.get("x-middleware-next")).toBeNull();
  });
  it.each(["http://test.example", "https://test.example"])("refreshes an expired cache using the cookie Better Auth actually issues on %s", async (origin) => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com,raojinbo@gmail.com";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    const cookies = getCookies({ baseURL: origin, advanced: authCookieOptions });
    const response = await middleware(new NextRequest(`${origin}/dashboard`, {
      headers: { cookie: `${cookies.sessionToken.name}=existing-signed-session` },
    }));

    expect(response.headers.get("location")).toBe(`${origin}/api/session-refresh?next=%2Fdashboard`);
  });
  it("normalizes a multi-email allowlist", () => {
    const configured = " RAOJIACUUI@gmail.com,raojinbo@gmail.com raojinbo@gmail.com ";
    expect(configuredAccessEmails(configured)).toEqual([
      "raojiacuui@gmail.com",
      "raojinbo@gmail.com",
    ]);
    expect(isAccessEmailAllowed("RAOJINBO@gmail.com", configured)).toBe(true);
    expect(isAccessEmailAllowed("someone@example.com", configured)).toBe(false);
  });

  it("leaves deployments unrestricted when the environment variable is absent", () => {
    expect(isAccessRestricted("")).toBe(false);
    expect(isAccessEmailAllowed("anyone@example.com", "")).toBe(true);
  });

  it("redirects anonymous page requests to login when restricted", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacuui@gmail.com,raojinbo@gmail.com";
    const response = await middleware(new NextRequest("https://test.example/dashboard?tab=analyze"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://test.example/login?next=%2Fdashboard%3Ftab%3Danalyze",
    );
  });

  it("accepts only an untampered signed cache for an approved email", async () => {
    const secret = "test-secret-test-secret-test-secret";
    const value = await signedSessionCookie("raojinbo@gmail.com", secret);
    const request = new Request("https://test.example/dashboard", {
      headers: { cookie: `__Secure-better-auth.session_data=${value}` },
    });
    expect(await verifiedCachedSessionEmail(request, secret)).toBe("raojinbo@gmail.com");

    const parsed = JSON.parse(decodeBase64Url(value)) as { signature: string };
    // The final base64url symbol can contain unused padding bits. Change the
    // first symbol so the decoded HMAC bytes always differ.
    const originalSignature = Buffer.from(parsed.signature, "base64url");
    parsed.signature = `${parsed.signature.startsWith("A") ? "B" : "A"}${parsed.signature.slice(1)}`;
    expect(Buffer.from(parsed.signature, "base64url").equals(originalSignature)).toBe(false);
    const tamperedValue = encodeBase64Url(JSON.stringify(parsed));
    const tampered = new Request("https://test.example/dashboard", {
      headers: { cookie: `__Secure-better-auth.session_data=${tamperedValue}` },
    });
    expect(await verifiedCachedSessionEmail(tampered, secret)).toBeNull();
  });

  it("routes an existing session through the server-side cache refresh endpoint", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";

    const response = await middleware(new NextRequest("https://test.example/dashboard", {
      headers: { cookie: "__Secure-better-auth.session_token=valid-session-token" },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://test.example/api/session-refresh?next=%2Fdashboard",
    );
  });

  it("stops after one unsuccessful cache refresh instead of redirecting forever", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";

    const response = await middleware(new NextRequest(
      "https://test.example/dashboard?tab=analyze&__pl_access_refreshed=1",
      {
      headers: { cookie: "better-auth.session_token=valid-session-token" },
      },
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://test.example/login?next=%2Fdashboard%3Ftab%3Danalyze&sessionRefreshFailed=1",
    );
  });

  it("keeps secret-authenticated worker and callback routes outside the browser gate", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacuui@gmail.com,raojinbo@gmail.com";
    for (const path of [
      "/api/cron/commercial-reconciliation",
      "/api/internal/analysis-run",
      "/api/payments/webhooks/alipay",
    ]) {
      const response = await middleware(new NextRequest(`https://test.example${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });
});
