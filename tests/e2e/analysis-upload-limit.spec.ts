import { test, expect } from "@playwright/test";
import { modelRegistry } from "../../lib/ai/model-registry";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`paid upload states single-shot limit ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, mode: "platform_credits", balance: 650, commercial: { credits: 650 }, trial: { remaining: 0, isAdmin: false }, capabilities: { videoAnalysis: { canUseLongVideo: true } } };
      else if (path === "/api/workflow/projects") body = { projects: [] };
      else if (path === "/api/models") body = { models: modelRegistry.filter(model => model.category === "analysis") };
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze");
    await expect(page.locator('select option[value="auto"]')).toHaveCount(0);
    await expect(page.getByLabel(locale === "zh" ? "分析模型" : "Analysis model")).toHaveValue("analysis-gemini-3-8-flash");
    await expect(page.locator("option").filter({ hasText: /Gemini 2\.5 Pro/i })).toHaveCount(0);
    await expect(page.getByText(locale === "zh" ? "选择 10 秒以内的单镜头片段或图片" : "Choose a single shot up to 10s, or an image", { exact: true })).toBeVisible();
    await expect(page.getByText(locale === "zh" ? /上传视频文件只支持 10 秒以内的完整单镜头片段，不拆镜/ : /Video file uploads only support one complete shot up to 10 seconds, without splitting/)).toBeVisible();
    await expect(page.getByText(locale === "zh" ? /付费分析不限视频时长/ : /Paid analysis has no source-duration cap/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/upload-limit-${locale}-${width}.png` });
  });
}
