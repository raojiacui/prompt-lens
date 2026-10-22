import { afterEach, describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => vi.fn(async () => Response.json({ ok: true })));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: next, POST: next, PATCH: next, PUT: next, DELETE: next }) }));
import { GET, POST, PATCH, PUT, DELETE } from "@/app/api/auth/[...all]/route";

const previousAllowedEmails = process.env.ACCESS_ALLOWED_EMAILS;

afterEach(() => {
  next.mockClear();
  if (previousAllowedEmails === undefined) delete process.env.ACCESS_ALLOWED_EMAILS;
  else process.env.ACCESS_ALLOWED_EMAILS = previousAllowedEmails;
});

describe("role-based admin plugin endpoints", () => {
  it("blocks every method before the plugin can grant roles or impersonate users", async () => {
    for (const [method, handler] of [["GET", GET], ["POST", POST], ["PATCH", PATCH], ["PUT", PUT], ["DELETE", DELETE]] as const) {
      const response = await handler(new Request("http://localhost/api/auth/admin/set-role", { method }));
      expect(response.status).toBe(403);
    }
    expect(next).not.toHaveBeenCalled();
  });
  it("blocks encoded admin paths as well", async () => {
    expect((await POST(new Request("http://localhost/api/auth/%61dmin%2fset-role", { method: "POST" }))).status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
  it("preserves normal login and session endpoints", async () => {
    expect((await GET(new Request("http://localhost/api/auth/get-session"))).status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("blocks anonymous registration even through encoded paths", async () => {
    for (const path of ["sign-in/anonymous", "sign-in/%61nonymous", "delete-anonymous-user"]) {
      expect((await POST(new Request(`http://localhost/api/auth/${path}`, { method: "POST" }))).status).toBe(403);
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted email OTP requests before sending mail", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacuui@gmail.com,raojinbo@gmail.com";
    const response = await POST(new Request("http://localhost/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@example.com", type: "sign-in" }),
    }));
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows both approved testers through the OTP policy", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacuui@gmail.com,raojinbo@gmail.com";
    for (const email of ["raojiacuui@gmail.com", "RAOJINBO@gmail.com"]) {
      const response = await POST(new Request("http://localhost/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "sign-in" }),
      }));
      expect(response.status).toBe(200);
    }
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("disables social sign-in while the test allowlist is active", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacuui@gmail.com,raojinbo@gmail.com";
    const response = await POST(new Request("http://localhost/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/dashboard" }),
    }));
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
