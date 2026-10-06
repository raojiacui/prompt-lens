import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`generation history survives reload ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let checked = false;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path === "/api/auth/get-session") body = { user: { id: "owner", name: "Owner", email: "owner@example.com" }, session: { id: "session", expiresAt: "2099-01-01T00:00:00Z" } };
      if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, commercial: { credits: 200 } };
      if (path === "/api/payments/account") body = { wallet: { credits: 200 } };
      if (path === "/api/generation-history") body = { history: [
        { id: "paid", taskId: "commercial:paid", payer: "platform", prompt: "A saved paid video", model: "veo3_fast", duration: "8", resolution: "720p", credits: 25, status: checked ? "completed" : "running", videoUrl: checked ? "https://media.example/video.mp4" : null, createdAt: new Date().toISOString() },
        { id: "own", taskId: "own-task", payer: "byok", prompt: "Own key prompt", model: "bytedance/seedance-2-mini", duration: "5", resolution: "480p", credits: 0, status: "failed", error: "Provider rejected the request", createdAt: new Date().toISOString() },
      ], hasMore: false, retentionDays: 7 };
      if (path === "/api/commercial/tasks/paid") { checked = true; body = { state: "completed" }; }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=video-gen");
    await page.reload();
    const history = page.getByRole("region", { name: locale === "zh" ? "生成历史" : "Generation history", exact: true });
    await expect(history.getByText(locale === "zh" ? /预留 25 积分/ : /Reserved 25 credits/)).toBeVisible();
    await history.getByRole("button", { name: locale === "zh" ? "查询任务状态" : "Check task status" }).click();
    await history.getByRole("button", { name: locale === "zh" ? "查看结果" : "View result" }).first().click();
    await expect(history.getByText("A saved paid video")).toBeVisible();
    await expect(history.locator("video")).toHaveAttribute("src", "https://media.example/video.mp4");
    await history.getByRole("button", { name: locale === "zh" ? "查看结果" : "View result" }).click();
    await expect(history.getByText("Own key prompt")).toBeVisible();
    await expect(history.getByText("Provider rejected the request")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/generation-history-${locale}-${width}.png`, fullPage: true });
  });
}
