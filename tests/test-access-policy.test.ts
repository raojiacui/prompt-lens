import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  configuredAccessEmails,
  isAccessEmailAllowed,
  isAccessRestricted,
} from "@/lib/auth/access-policy";
import { verifiedCachedSessionEmail } from "@/lib/auth/session-cache-access";
import { middleware } from "@/middleware";

const previousAllowedEmails = process.env.ACCESS_ALLOWED_EMAILS;

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signedSessionCookie(email: string, secret: string) {
  const session = {
    session: { id: "session-1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    user: { id: "user-1", email },
    updatedAt: Date.now(),
    version: "1",
  };
  const expiresAt = Date.now() + 60_000;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify({ ...session, expiresAt })),
  ));
  return encodeBase64Url(JSON.stringify({
    session,
    expiresAt,
    signature: encodeBase64Url(signature),
  }));
}

afterEach(() => {
  if (previousAllowedEmails === undefined) delete process.env.ACCESS_ALLOWED_EMAILS;
  else process.env.ACCESS_ALLOWED_EMAILS = previousAllowedEmails;
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

    const tampered = new Request("https://test.example/dashboard", {
      headers: { cookie: `__Secure-better-auth.session_data=${value.slice(0, -1)}A` },
    });
    expect(await verifiedCachedSessionEmail(tampered, secret)).toBeNull();
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
