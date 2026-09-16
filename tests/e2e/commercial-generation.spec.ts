import { test, expect } from "@playwright/test";
for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`generation total and explicit confirmation ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let quotes = 0;
    let confirmed: string[] = [];
    let legacySubmissions = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, commercial: { credits: 650, rewrites: 60 } };
      else if (path === "/api/models") body = { models: [] };
      else if (path === "/api/commercial/generation") { quotes++; body = { id: `quote-${quotes}`, credits: 95, model: "wan/2-6-text-to-video", duration: 5, resolution: "720p" }; }
      else if (path === "/api/commercial/confirm") { confirmed = route.request().postDataJSON().ids; body = { tasks: confirmed.map((id) => ({ id, state: "queued" })) }; }
      else if (path.startsWith("/api/commercial/tasks/")) body = { state: "running" };
      else if (path === "/api/generation-jobs" && route.request().method() === "POST") legacySubmissions++;
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=video-gen&duration=5&videoGenPrompt=A%20cinematic%20cloud%20palace");
    await page.getByLabel(locale === "zh" ? "费用来源" : "Payment source").selectOption("platform");
    await page.getByRole("button", { name: /720p.*5s|5s.*720p/i }).click();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.getByRole("button", { name: locale === "zh" ? "生成视频" : "Generate Video", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: locale === "zh" ? "获取报价" : "Get quote" }).click();
    await expect(dialog.getByText(locale === "zh" ? "190 积分" : "190 credits", { exact: true })).toBeVisible();
    expect(quotes).toBe(2); expect(confirmed).toHaveLength(0); expect(legacySubmissions).toBe(0);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/generation-quote-${locale}-${width}.png` });
    await dialog.getByRole("button", { name: locale === "zh" ? "确认并生成" : "Confirm and generate" }).click();
    await expect.poll(() => confirmed.length).toBe(2);
    expect(confirmed).toEqual(["quote-1", "quote-2"]); expect(legacySubmissions).toBe(0);
  });
}
