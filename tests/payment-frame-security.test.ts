import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

describe("payment frame security headers", () => {
  it("permits only same-origin framing for the authenticated payment form", () => {
    const response = middleware(new NextRequest("http://localhost/api/payments/orders/11111111-1111-4111-8111-111111111111/pay?embedded=1"));
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
  });
  it.each(["/", "/dashboard", "/api/payments/checkout", "/api/payments/orders/not-an-id/pay"])("keeps clickjacking protection on %s", (path) => {
    const response = middleware(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});
