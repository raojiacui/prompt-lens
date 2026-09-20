import { describe, expect, it } from "vitest";
import { renderWelcomeEmail } from "@/lib/email/welcome-email";

describe("welcome email", () => {
  it("renders the Chinese onboarding story and creation CTA", () => {
    const result = renderWelcomeEmail({
      locale: "zh",
      name: "嘉翠",
      siteUrl: "https://prompt-lens.cc.cd",
    });

    expect(result.subject).toContain("欢迎来到 Prompt Lens");
    expect(result.html).toContain("嘉翠，欢迎来到 Prompt Lens");
    expect(result.html).toContain("看懂每个镜头");
    expect(result.html).toContain("复刻完整质感");
    expect(result.html).toContain("改写成你的故事");
    expect(result.html).toContain("开始创造");
    expect(result.html).toContain("/images/hero-text-fishing.jpg");
    expect(result.html).toContain("/prompt-lens-icon.png");
    expect(result.html).not.toContain(">P</td>");
    expect(result.dashboardUrl).toBe("https://prompt-lens.cc.cd/dashboard?utm_source=welcome_email&utm_medium=email&utm_campaign=welcome");
  });

  it("renders English and does not use an email address as the greeting name", () => {
    const result = renderWelcomeEmail({
      locale: "en",
      name: "creator@example.com",
      siteUrl: "https://prompt-lens.cc.cd/ignored-path",
    });

    expect(result.subject).toContain("Welcome to Prompt Lens");
    expect(result.html).toContain("Understand every shot");
    expect(result.html).not.toContain("creator@example.com");
    expect(result.dashboardUrl).toContain("https://prompt-lens.cc.cd/dashboard");
  });

  it("escapes the display name and rejects unsafe site protocols", () => {
    const result = renderWelcomeEmail({
      locale: "zh",
      name: "<Creator>",
      siteUrl: "javascript:alert(1)",
    });

    expect(result.html).toContain("&lt;Creator&gt;");
    expect(result.html).not.toContain("<Creator>");
    expect(result.dashboardUrl).toContain("https://prompt-lens.cc.cd/dashboard");
  });
});
