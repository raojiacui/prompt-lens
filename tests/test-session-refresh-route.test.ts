import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

import { GET } from "@/app/api/session-refresh/route";

const previousAllowedEmails = process.env.ACCESS_ALLOWED_EMAILS;

afterEach(() => {
  getSessionMock.mockReset();
  if (previousAllowedEmails === undefined) delete process.env.ACCESS_ALLOWED_EMAILS;
  else process.env.ACCESS_ALLOWED_EMAILS = previousAllowedEmails;
});

describe("V2 test session refresh route", () => {
  it("refreshes an allowed database session and returns to the requested page", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com";
    getSessionMock.mockResolvedValue({
      response: {
        session: { expiresAt: new Date(Date.now() + 60_000) },
        user: { email: "raojiacui@gmail.com" },
      },
      headers: new Headers({
        "set-cookie": "__Secure-better-auth.session_data=refreshed; Path=/; HttpOnly",
      }),
    });

    const response = await GET(new Request(
      "https://test.example/api/session-refresh?next=%2Fdashboard%3Ftab%3Danalyze",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://test.example/dashboard?tab=analyze&__pl_access_refreshed=1",
    );
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_data=refreshed");
    expect(getSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      query: { disableCookieCache: true },
      returnHeaders: true,
    }));
  });

  it("sends invalid sessions to login and rejects external return URLs", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com";
    getSessionMock.mockResolvedValue({ response: null, headers: new Headers() });

    const response = await GET(new Request(
      "https://test.example/api/session-refresh?next=https%3A%2F%2Fevil.example",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://test.example/login?next=%2Fdashboard&sessionRefreshFailed=1",
    );
  });

  it("stops automatic login redirects when the database lookup fails", async () => {
    process.env.ACCESS_ALLOWED_EMAILS = "raojiacui@gmail.com";
    getSessionMock.mockRejectedValue(new Error("Temporary database failure"));

    const response = await GET(new Request("https://test.example/api/session-refresh?next=%2Fdashboard"));

    expect(response.headers.get("location")).toBe(
      "https://test.example/login?next=%2Fdashboard&sessionRefreshFailed=1",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
