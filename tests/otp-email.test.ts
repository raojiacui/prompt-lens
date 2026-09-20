import { describe, expect, it } from "vitest";
import { renderOtpEmail, resolveEmailLocale } from "@/lib/email/otp-email";

describe("OTP email", () => {
  it("renders a branded Chinese login email with matching expiry copy", () => {
    const result = renderOtpEmail({
      otp: "625183",
      locale: "zh",
      purpose: "sign-in",
      expiresInMinutes: 10,
    });

    expect(result.subject).toBe("Prompt Lens 登录验证码");
    expect(result.html).toContain("欢迎回到 Prompt Lens");
    expect(result.html).toContain("625183");
    expect(result.html).toContain("10 分钟后失效");
    expect(result.text).toContain("请勿将验证码告诉任何人");
  });

  it("renders the English version and escapes dynamic content", () => {
    const result = renderOtpEmail({
      otp: "<12345",
      locale: "en",
      purpose: "sign-in",
    });

    expect(result.subject).toBe("Your Prompt Lens sign-in code");
    expect(result.html).toContain("Welcome back to Prompt Lens");
    expect(result.html).toContain("&lt;12345");
    expect(result.html).not.toContain("><12345<");
  });

  it("prefers the explicit locale, then the locale cookie, then Accept-Language", () => {
    expect(resolveEmailLocale(new Headers({ "x-prompt-lens-locale": "en", cookie: "NEXT_LOCALE=zh" }))).toBe("en");
    expect(resolveEmailLocale(new Headers({ cookie: "foo=1; NEXT_LOCALE=en" }))).toBe("en");
    expect(resolveEmailLocale(new Headers({ "accept-language": "en-US,en;q=0.9" }))).toBe("en");
    expect(resolveEmailLocale(new Headers({ "accept-language": "fr-FR" }))).toBe("zh");
  });
});
