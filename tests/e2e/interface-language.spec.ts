import { expect, test } from "@playwright/test";

for (const locale of ["zh", "en"]) {
  for (const width of [1440, 390]) {
    test(`interface language ${locale} at ${width}px`, async ({ page, context }) => {
      const zh = locale === "zh";
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
      await page.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
        const body = path.includes("/auth/get-session")
          ? { session: { id: "test", token: "test", expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: "test", email: "test@example.com", name: "Test" } }
          : path === "/api/samples" ? { samples: [{ id: "sample", title: "User custom title", mediaType: "video", status: "ready", sceneCount: 3, createdAt: "2026-10-01T00:00:00Z" }] }
          : path === "/api/workflow/projects" ? { projects: [] }
          : path === "/api/credits/me" ? { mode: "byok", balance: 0, hasUserKieKey: true, trial: { limit: 2, remaining: 2 } }
          : path === "/api/models" ? { models: [] } : {};
        await route.fulfill({ json: body });
      });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(zh ? "从参考视频" : "Turn any AI video");
      await expect(page.getByRole("heading", { name: zh ? "常见问题" : "FAQs", exact: true })).toBeVisible();
      await page.goto("/samples");
      await expect(page.getByPlaceholder(zh ? "搜索项目名或提示词" : "Search projects or prompts")).toBeVisible();
      await expect(page.getByText(zh ? "已就绪" : "Ready", { exact: true })).toBeVisible();
      await expect(page.getByText(zh ? "3 个镜头" : "3 shots", { exact: true })).toBeVisible();
      await expect(page.getByText("User custom title", { exact: true })).toBeVisible();
      await page.goto("/dashboard?tab=analyze");
      await expect(page.getByRole("heading", { name: zh ? "我的项目" : "Your projects", exact: true })).toBeVisible();
      await expect(page.getByText(zh ? "分析结果会显示在这里" : "Your analysis will appear here", { exact: true })).toBeVisible();
      await expect(page.getByText(zh ? "还没有项目" : "No projects yet", { exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/interface-${locale}-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
}
