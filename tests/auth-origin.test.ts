import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRODUCTION_ORIGIN,
  getAuthBaseURL,
  getCanonicalProductionRedirect,
} from "@/lib/auth/origin";

describe("authentication origin", () => {
  it("uses the server-only Better Auth URL before public fallbacks", () => {
    expect(getAuthBaseURL({
      BETTER_AUTH_URL: "https://auth.example.com",
      NEXT_PUBLIC_BETTER_AUTH_URL: "https://public.example.com",
      NEXT_PUBLIC_SITE_URL: "https://site.example.com",
    })).toBe("https://auth.example.com");
  });

  it("always uses the live custom domain in production", () => {
    expect(getAuthBaseURL({
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: "https://prompt-lens-git-main.vercel.app",
    })).toBe(DEFAULT_PRODUCTION_ORIGIN);
  });

  it("redirects production aliases to the canonical origin", () => {
    expect(getCanonicalProductionRedirect(
      new URL("https://prompt-lens-git-main.vercel.app/login?from=home"),
      { VERCEL_ENV: "production", BETTER_AUTH_URL: DEFAULT_PRODUCTION_ORIGIN },
    )?.toString()).toBe(`${DEFAULT_PRODUCTION_ORIGIN}/login?from=home`);
  });

  it("does not redirect the canonical origin or non-production environments", () => {
    expect(getCanonicalProductionRedirect(
      new URL(`${DEFAULT_PRODUCTION_ORIGIN}/login`),
      { VERCEL_ENV: "production", BETTER_AUTH_URL: DEFAULT_PRODUCTION_ORIGIN },
    )).toBeNull();
    expect(getCanonicalProductionRedirect(
      new URL("https://prompt-lens-preview.vercel.app/login"),
      { VERCEL_ENV: "preview", BETTER_AUTH_URL: DEFAULT_PRODUCTION_ORIGIN },
    )).toBeNull();
  });
});
