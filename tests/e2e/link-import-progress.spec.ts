import { expect, test } from "@playwright/test";

for (const locale of ["zh", "en"] as const) for (const width of [1440, 390]) {
  test(`live link import stages ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    await page.addInitScript(() => {
      const nativeFetch = window.fetch;
      window.fetch = async (...args) => {
        if (String(args[0]) !== "/api/media/resolve-link") return nativeFetch(...args);
        const encoder = new TextEncoder();
        const stream = new ReadableStream({ start(controller) {
          for (const [index, stage] of ["checking-worker", "resolving", "saving"].entries()) {
            setTimeout(() => controller.enqueue(encoder.encode(`${JSON.stringify({ type: "stage", stage })}\n`)), index * 1500);
          }
        } });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      };
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, mode: "byok", hasUserKieKey: true, balance: 0, trial: { remaining: 0 }, commercial: { enabled: true, credits: 200, rewrites: 20 }, linkImports: { remaining: 10 } };
      else if (path === "/api/models") body = { models: [] };
      else if (path === "/api/workflow/projects") body = { projects: [] };
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze");
    await page.getByRole("tab", { name: locale === "zh" ? "粘贴链接" : "Paste link" }).click();
    await page.getByLabel(locale === "zh" ? "视频链接" : "Video link", { exact: true }).fill("https://www.bilibili.com/video/BV11mFLziEyP/");
    await page.getByTestId("analysis-action-row").getByRole("button").click();
    await expect(page.getByRole("heading", { name: locale === "zh" ? "解析视频链接" : "Resolving video link" })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale === "zh" ? "下载并保存视频" : "Downloading and saving video" })).toBeVisible();
    await expect(page.getByText(locale === "zh" ? /已等待 [1-9]\d* 秒/ : /Elapsed [1-9]\d*s/)).toBeVisible();
    await expect(page.getByText("5%", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("analysis-action-row").getByRole("button")).toBeDisabled();
    await expect(page.getByText("100%", { exact: true })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    const panel = page.getByRole("heading", { name: locale === "zh" ? "下载并保存视频" : "Downloading and saving video" }).locator("..").locator("..").locator("..");
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: `test-results/link-progress-panel-${locale}-${width}.png` });
    await page.screenshot({ path: `test-results/link-progress-${locale}-${width}.png`, fullPage: true });
  });
}
