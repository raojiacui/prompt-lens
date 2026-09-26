import { test, expect } from "@playwright/test";
for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`analysis quote and confirmation ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    const projectId = "11111111-1111-4111-8111-111111111111";
    const taskId = "22222222-2222-4222-8222-222222222222";
    let confirmations = 0;
    let quoteRequest: Record<string, unknown> | undefined;
    await page.route("https://example.com/upload", (r) => r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "PUT, OPTIONS", "Access-Control-Allow-Headers": "*" }, body: "" }));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, mode: "platform_credits", trial: { limit: 2, remaining: 0 }, commercial: { enabled: true, credits: 200, rewrites: 20 } };
      else if (path === "/api/models") body = { models: [] };
      else if (path === "/api/workflow/projects") body = route.request().method() === "POST" ? { project: { id: projectId } } : { projects: [] };
      else if (path === "/api/upload") body = { presignedUrl: "https://example.com/upload", publicUrl: "https://example.com/video.mp4", key: "uploaded", mediaType: "video" };
      else if (path === "/api/commercial/analysis") {
        const data = route.request().postDataJSON();
        if (data.action === "prepare") body = { id: "preview", durationUs: 10000000, scenes: [{ id: "1", startUs: 0, endUs: 2000000 }, { id: "2", startUs: 2000000, endUs: 10000000 }] };
        else { quoteRequest = data; body = { id: taskId, credits: 8, splitCredits: 2, analysisCredits: 6 }; }
      } else if (path === `/api/commercial/tasks/${taskId}`) {
        if (route.request().method() === "POST") confirmations++;
        body = { id: taskId, state: "running", credits: 8 };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze");
    await page.locator('input[type="file"]').first().setInputFiles("public/remotion/remix-flow/rewrite-before.mp4");
    await page.getByRole("button", { name: locale === "zh" ? "分析视频" : "Analyze video", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: locale === "zh" ? "读取视频信息" : "Inspect video" }).click();
    await expect(dialog.getByText(/^10\.00s · 2/)).toBeVisible();
    expect(confirmations).toBe(0);
    await dialog.getByRole("button", { name: locale === "zh" ? "获取报价" : "Get quote" }).click();
    await expect(dialog.getByText(locale === "zh" ? "8 积分" : "8 credits", { exact: true })).toBeVisible();
    expect(quoteRequest).toMatchObject({ payer: "platform", sceneIds: ["1", "2"] });
    expect(confirmations).toBe(0);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/analysis-quote-${locale}-${width}.png` });
    await dialog.getByRole("button", { name: locale === "zh" ? "确认并开始" : "Confirm and start" }).click();
    await expect.poll(() => confirmations).toBe(1);
  });
}
