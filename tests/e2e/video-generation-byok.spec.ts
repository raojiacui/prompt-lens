import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  for (const personalKey of [false, true]) {
    test(`personal key and explicit model ${width} ${personalKey}`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
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
      await page.getByRole("button", { name: "视频生成", exact: true }).click();
      const model = page.getByLabel("生成模型");
      await expect(model).toHaveValue("");
      await page.locator("textarea").first().fill("A cinematic cloud palace");
      const generate = page.getByRole("button", { name: "开始生成视频", exact: true });
      await expect(generate).toBeDisabled();
      await model.selectOption("kling-2.6/text-to-video");
      const controls = model.locator("xpath=../..");
      await expect(controls.locator("select").nth(1)).not.toContainText("15");
      await expect(controls.locator("select").nth(2)).toHaveValue("1080p");
      if (personalKey) {
        await expect(generate).toBeEnabled();
        await generate.click();
        await expect.poll(() => submitted?.model).toBe("kling-2.6/text-to-video");
      } else {
        await expect(generate).toBeDisabled();
        await expect(page.getByText("视频生成需要你自己的 KIE API Key，费用由你的 KIE 账户承担。")).toBeVisible();
      }
      await page.screenshot({ path: `temp/byok-${width}-${personalKey}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (!personalKey) {
        await page.getByRole("button", { name: "配置 API Key", exact: true }).click();
        await expect(model).toHaveCount(0);
        expect(submitted).toBeUndefined();
      }
    });
  }
}
