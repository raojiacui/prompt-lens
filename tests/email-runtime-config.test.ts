import { afterEach, describe, expect, it } from "vitest";
import { getEmailRuntimeConfig } from "@/lib/email/runtime-config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("email runtime config", () => {
  it("uses public email URLs instead of localhost app URLs", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.EMAIL_PUBLIC_SITE_URL = "https://prompt-lens.cc.cd";
    process.env.EMAIL_ASSET_BASE_URL = "https://cdn.example.com";

    expect(getEmailRuntimeConfig()).toEqual({
      siteUrl: "https://prompt-lens.cc.cd",
      iconUrl: "https://cdn.example.com/email/prompt-lens-icon.png",
      heroUrl: "https://cdn.example.com/email/hero-text-fishing.jpg",
    });
  });
});
