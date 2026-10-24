import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
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
    parsed.signature = `${parsed.signature.slice(0, -1)}${parsed.signature.endsWith("A") ? "B" : "A"}`;
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
      headers: { cookie: "__Secure-prompt-lens.session_token=valid-session-token" },
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
      headers: { cookie: "prompt-lens.session_token=valid-session-token" },
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
