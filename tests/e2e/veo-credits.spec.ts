import { test, expect } from "@playwright/test";
import { modelRegistry } from "../../lib/ai/model-registry";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`Veo credits and confirmation ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let quoteRequests = 0;
    let confirmations = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/models") body = { models: modelRegistry };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, commercial: { credits: 650, rewrites: 60 } };
      else if (path === "/api/commercial/generation") {
        quoteRequests++;
        const request = route.request().postDataJSON();
        expect(request).toMatchObject({ model: "veo3_fast", duration: 8 });
        expect(request.quality).toMatch(/^(720P|1080P)$/);
        body = { id: "veo-quote", credits: 35, model: "veo3_fast", duration: 8, resolution: request.quality.toLowerCase() };
      } else if (path === "/api/commercial/confirm") {
        confirmations++;
        body = { tasks: [{ id: "veo-quote", state: "queued" }] };
      } else if (path.startsWith("/api/commercial/tasks/")) body = { state: "running" };
      await route.fulfill({ json: body });
    });
    await page.addInitScript(() => localStorage.setItem("reference-settings-prompt-lens-video-gen", JSON.stringify({ model: "__auto_balanced", duration: "0s", quality: "1080P" })));
    await page.goto("/dashboard?tab=video-gen&videoGenPrompt=A%20cinematic%20cloud%20palace");
    await expect(page.locator("select").filter({ has: page.locator('option[value="bytedance/seedance-2-mini"]') })).toHaveValue("bytedance/seedance-2-mini");
    await expect(page.locator('option[value="__auto_balanced"]')).toHaveCount(0);
    await page.getByLabel(locale === "zh" ? "费用来源" : "Payment source").selectOption("platform");
    const miniGenerate = page.getByRole("button", { name: locale === "zh" ? /生成视频.*预计 15 积分/ : /Generate Video.*Est. 15 credits/i });
    await expect(page.getByRole("button", { name: locale === "zh" ? /生成视频.*预计 25 积分/ : /Generate Video.*Est. 25 credits/i })).toBeVisible();
    await page.getByRole("button", { name: /720P.*5/ }).click();
    await expect(page.getByRole("button", { name: "1080P", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "4K", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "480P", exact: true }).click();
    await expect(miniGenerate).toBeVisible();
    await page.getByRole("button", { name: "720P", exact: true }).click();
    await expect(page.getByRole("button", { name: locale === "zh" ? /生成视频.*预计 25 积分/ : /Generate Video.*Est. 25 credits/i })).toBeVisible();
    await page.goto("/dashboard?tab=video-gen&model=veo3_lite&duration=8&videoGenPrompt=A%20cinematic%20cloud%20palace");
    await expect(page.locator('option[value="__auto_balanced"]')).toHaveCount(0);
    await expect(page.locator("option").filter({ hasText: /HappyHorse|Grok|Kling Omni Transformation/i })).toHaveCount(0);
    await page.getByLabel(locale === "zh" ? "费用来源" : "Payment source").selectOption("platform");
    const generate = page.getByRole("button", { name: locale === "zh" ? /生成视频.*预计 20 积分/ : /Generate Video.*Est. 20 credits/i });
    await expect(generate).toBeVisible();
    const models = page.locator("select").filter({ has: page.locator('option[value="veo3_lite"]') });
    await models.selectOption("veo3_fast");
    const fast = page.getByRole("button", { name: locale === "zh" ? /生成视频.*预计 35 积分/ : /Generate Video.*Est. 35 credits/i });
    await expect(fast).toBeVisible();
    expect(quoteRequests).toBe(0);
    await fast.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: locale === "zh" ? "获取报价" : "Get quote" }).click();
    await expect(dialog.getByText(locale === "zh" ? "35 积分" : "35 credits", { exact: true }).first()).toBeVisible();
    expect(quoteRequests).toBe(1);
    expect(confirmations).toBe(0);
    await page.screenshot({ path: `test-results/veo-${locale}-${width}.png` });
    await dialog.getByRole("button", { name: locale === "zh" ? "确认并生成" : "Confirm and generate" }).click();
    await expect.poll(() => confirmations).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goto("/guide#credits");
    await expect(page.getByRole("main")).not.toContainText(/Gemini 2\.5 Pro|HappyHorse|Grok|Kling Omni/i);
    await expect(page.getByRole("heading", { name: locale === "zh" ? "Veo 3.1 生成积分表（每条）" : "Veo 3.1 generation credits (per output)" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
