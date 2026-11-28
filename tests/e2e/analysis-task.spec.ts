import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

for (const width of [1440, 390]) {
  test(`paid image analysis requires an explicit quote confirmation at ${width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    const localSecret = process.env.DIAGNOSTICS_TEST_AUTH_SECRET;
    if (localSecret) {
      expect(new URL(baseURL!).hostname).toBe("localhost");
      const now = Date.now(), expiresAt = now + 3600000;
      const session = { session: { id: "isolated-image-test", userId: "test", token: "local-test-token", expiresAt: new Date(expiresAt).toISOString() }, user: { id: "test", name: "Test", email: "raojiacui@gmail.com" }, updatedAt: now, version: "1" };
      const signature = createHmac("sha256", localSecret).update(JSON.stringify({ ...session, expiresAt })).digest("base64url");
      await context.addCookies([{ name: "better-auth.session_data", value: Buffer.from(JSON.stringify({ session, expiresAt, signature })).toString("base64url"), domain: "localhost", path: "/" }]);
    }
    const projectId = "11111111-1111-4111-8111-111111111111";
    const taskId = "22222222-2222-4222-8222-222222222222";
    let submissions = 0;
    let polls = 0;
    let quotes = 0;
    const project = { id: projectId, title: "已完成的图片分析", status: "ready", metadata: { mediaType: "image" } };
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
        expect(route.request().postDataJSON()).toMatchObject({ modelMode: "manual", modelId: "analysis-gemini-3-8-flash" });
        body = { taskId, state: "queued" };
      } else if (path === "/api/commercial/image-analysis") {
        quotes++;
        expect(route.request().postDataJSON()).toMatchObject({ modelId: "analysis-gemini-3-8-flash", projectId });
        body = { id: taskId, credits: 4, expiresAt: new Date(Date.now() + 600000).toISOString() };
      } else if (path === `/api/commercial/tasks/${taskId}` && route.request().method() === "POST") {
        submissions++;
        body = { id: taskId, state: "queued", credits: 4 };
      } else if (path === `/api/commercial/tasks/${taskId}`) {
        polls++;
        body = polls < 2 ? { state: "running", totalScenes: 1, completedScenes: 0 } : { state: "completed", bundle };
      } else if (path.startsWith("/api/commercial/analysis")) quotes++;
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze");
    await expect(page.getByLabel("分析模型")).toBeDisabled();
    await page.locator('input[type="file"]').first().setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
    await page.getByRole("button", { name: "分析图片", exact: true }).click();
    await expect(page.getByRole("region", { name: "图片分析报价" })).toBeVisible();
    await expect(page.getByText("图片分析 · 1 张 · 4 积分")).toBeVisible();
    expect(submissions).toBe(0);
    expect(polls).toBe(0);
    await page.getByRole("button", { name: "确认并分析", exact: true }).click();
    await expect.poll(() => polls, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("已完成的图片分析").first()).toBeVisible();
    expect(submissions).toBe(1);
    expect(quotes).toBe(1);
    await page.screenshot({ path: `test-results/analysis-task-${width}.png` });
  });
}
