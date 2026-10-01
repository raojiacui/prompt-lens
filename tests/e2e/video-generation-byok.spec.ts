import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  for (const personalKey of [false, true]) {
    test(`personal key and explicit model ${locale} ${width} ${personalKey}`, async ({ page, context }) => {
      const zh = locale === "zh";
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
      let submitted: Record<string, unknown> | undefined;
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        let json: unknown = {};
        if (url.pathname.includes("/auth/get-session")) json = { user: { id: "test", name: "Test", email: "test@example.com" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
        else if (url.pathname === "/api/analyze/quota") json = { limit: 2, used: 0, remaining: 2, hasOwnApiKey: personalKey };
        else if (url.pathname === "/api/video-generate") {
          if (route.request().method() === "POST") { submitted = route.request().postDataJSON(); json = { taskId: "mock-task" }; }
          else json = url.searchParams.has("access") ? { hasOwnApiKey: personalKey } : { records: [] };
        } else if (url.pathname === "/api/video-generate/status") json = { status: "completed", videoUrl: null };
        else if (url.pathname === "/api/settings/api-key") json = { apiKeys: [] };
        await route.fulfill({ json });
      });
      await page.goto("/dashboard");
      await page.getByRole("button", { name: zh ? "视频生成" : "Video Generate", exact: true }).click();
      const model = page.getByLabel(zh ? "生成模型" : "Generation model");
      await expect(model).toHaveValue("");
      await page.locator("textarea").first().fill("A cinematic cloud palace");
      const generate = page.getByRole("button", { name: zh ? "开始生成视频" : "Start Generating Video", exact: true });
      await expect(generate).toBeDisabled();
      await expect(model.locator("optgroup[label='Seedance'] option")).toHaveCount(10);
      await expect(model.locator("optgroup[label='Veo'] option")).toHaveCount(2);
      await expect(model.locator("optgroup[label='Sora']")).toHaveCount(0);
      await expect(model.locator("option[value^='sora-']")).toHaveCount(0);
      await model.selectOption("bytedance/seedance-2-mini");
      const controls = model.locator("xpath=../..");
      await expect(controls.locator("select").nth(2)).not.toContainText("1080p");
      await expect(page.locator('input[type="file"][accept="image/*"]')).toHaveCount(1);
      await model.selectOption("veo3_fast");
      await expect(controls.locator("select").nth(1)).toHaveValue("8");
      await model.selectOption("kling-2.6/text-to-video");
      await expect(page.locator('input[type="file"][accept="image/*"]')).toHaveCount(0);
      await expect(controls.locator("select").nth(1)).not.toContainText("15");
      await expect(controls.locator("select").nth(2)).toHaveValue("1080p");
      if (personalKey) {
        await expect(generate).toBeEnabled();
        await generate.click();
        await expect.poll(() => submitted?.model).toBe("kling-2.6/text-to-video");
      } else {
        await expect(generate).toBeDisabled();
        await expect(page.getByRole("heading", { name: zh ? "生成前必须配置自己的 KIE API Key" : "Your own KIE API key is required" })).toBeVisible();
      }
      await page.screenshot({ path: `temp/byok-${locale}-${width}-${personalKey}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (!personalKey) {
        await page.getByRole("button", { name: zh ? "前往设置，配置 API Key" : "Configure API key in Settings", exact: true }).click();
        await expect(model).toHaveCount(0);
        expect(submitted).toBeUndefined();
      }
    });
  }
}
