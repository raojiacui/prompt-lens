import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) {
  for (const width of [1440, 390]) {
    test(`rewrite payment choice ${locale} ${width}`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
      const project = { id: "project-1", title: "Commercial rewrite preview", status: "ready", updatedAt: new Date().toISOString(), activeVersionId: "version-1" };
      const version = { id: "version-1", label: "Original", versionNumber: 1, kind: "original", overview: {} };
      const scene = { id: "scene-version-1", projectVersionId: version.id, originalSceneId: "scene-1", sceneIndex: 1, story: {}, visual: {}, dialogue: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "A woman walks through a palace corridor above the clouds.", duration: 2 };
      let requestBody: Record<string, unknown> | undefined;
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        let body: unknown = {};
        if (path.includes("/auth/get-session")) body = { session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() }, user: { id: "test", email: "test@example.com", name: "Test", role: "user" } };
        else if (path === "/api/credits/me") body = { balance: 10, mode: "byok", hasUserKieKey: true, trial: { limit: 2, used: 0, remaining: 2, isAdmin: false }, commercial: { enabled: true, credits: 200, rewrites: 20, heldRewrites: 0 } };
        else if (path === "/api/models") body = { models: [] };
        else if (path === "/api/workflow/projects") body = { projects: [project] };
        else if (path.endsWith("/rewrite")) {
          requestBody = route.request().postDataJSON();
          body = { scene: { ...scene, id: "scene-version-2" } };
        } else if (path === "/api/workflow/projects/project-1") body = {
          project, versions: [version], activeVersion: version,
          scenes: [{ id: "scene-1", sceneIndex: 1, startTime: 0, endTime: 2, duration: 2, status: "completed", keyframeUrls: ["/remotion/landing-ad/analysis-shot-01.jpg"] }],
          sceneVersions: [scene], allSceneVersions: [scene],
        };
        await route.fulfill({ json: body });
      });
      await page.goto("/dashboard?tab=analyze");
      await page.getByRole("button", { name: /Commercial rewrite preview/ }).click();
      const payer = page.getByLabel(locale === "en" ? "Rewrite payment source" : "改写费用来源");
      await expect(payer).toBeVisible();
      await expect(payer).toHaveValue("included");
      await expect(page.getByText(locale === "en" ? "1 rewrite · No extra credits" : "消耗 1 次 · 不另扣积分", { exact: true })).toBeVisible();
      await payer.selectOption("byok");
      await expect(page.getByText(locale === "en" ? "Billed to your KIE account" : "费用由你的 KIE 账户承担", { exact: true })).toBeVisible();
      await page.getByPlaceholder("Make this scene warmer and more comedic, but keep the same timing and camera move.").fill("Replace the woman with a man in a suit.");
      await page.getByRole("button", { name: "重写脚本", exact: true }).click();
      await expect.poll(() => requestBody?.payer).toBe("byok");
      expect(requestBody?.requestId).toMatch(/^[0-9a-f-]{36}$/);
      await payer.selectOption("included");
      await payer.scrollIntoViewIfNeeded();
      const box = await payer.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `test-results/rewrite-billing-${locale}-${width}.png`, fullPage: true });
    });
  }
}
