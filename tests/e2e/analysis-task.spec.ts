import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`trial analysis remains available with commercial billing at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    const projectId = "11111111-1111-4111-8111-111111111111";
    const taskId = "22222222-2222-4222-8222-222222222222";
    let submissions = 0;
    let polls = 0;
    let quotes = 0;
    const project = { id: projectId, title: "已完成的试用分析", status: "ready", metadata: { mediaType: "image" } };
    const bundle = { project, versions: [], activeVersion: null, scenes: [], sceneVersions: [], allSceneVersions: [] };
    await page.route("https://example.com/upload", route => route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "PUT, OPTIONS", "Access-Control-Allow-Headers": "*" }, body: "" }));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, mode: "trial", trial: { limit: 2, used: 0, remaining: 2 }, commercial: { enabled: true, credits: 0, rewrites: 0 } };
      else if (path === "/api/models") body = { models: [{ id: "analysis-gemini-3-8-flash", displayName: "Gemini 3.8 Flash", enabled: true, provider: "kie" }] };
      else if (path === "/api/workflow/projects") body = route.request().method() === "POST" ? { project: { id: projectId } } : { projects: polls > 1 ? [project] : [] };
      else if (path === "/api/upload") body = { presignedUrl: "https://example.com/upload", publicUrl: "https://example.com/image.png", key: "uploads/test/image.png" };
      else if (path === `/api/workflow/projects/${projectId}/breakdown`) {
        submissions++;
        expect(route.request().postDataJSON()).toMatchObject({ modelMode: "auto" });
        body = { taskId, state: "queued" };
      } else if (path === `/api/commercial/tasks/${taskId}`) {
        polls++;
        body = polls < 2 ? { state: "running", totalScenes: 1, completedScenes: 0 } : { state: "completed", bundle };
      } else if (path.startsWith("/api/commercial/analysis")) quotes++;
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze");
    await expect(page.getByLabel("Analysis model")).toBeDisabled();
    await expect(page.getByLabel("Analysis model")).toHaveValue("analysis-gemini-3-8-flash");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
    await page.getByRole("button", { name: "分析图片", exact: true }).click();
    await expect.poll(() => polls, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("已完成的试用分析").first()).toBeVisible();
    expect(submissions).toBe(1);
    expect(quotes).toBe(0);
    await page.screenshot({ path: `test-results/analysis-task-${width}.png` });
  });
}
