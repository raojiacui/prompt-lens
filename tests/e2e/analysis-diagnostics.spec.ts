import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

for (const width of [1440, 390]) test(`task diagnostics and interrupted status sync at ${width}px`, async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width, height: 950 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const id = "22222222-2222-4222-8222-222222222222";
  const now = Date.now();
  const localSecret = process.env.DIAGNOSTICS_TEST_AUTH_SECRET;
  if (localSecret) {
    expect(new URL(baseURL!).hostname).toBe("localhost");
    const expiresAt = now + 3600000;
    const session = { session: { id: "isolated-test", userId: "test", token: "local-test-token", expiresAt: new Date(expiresAt).toISOString() }, user: { id: "test", name: "Test", email: "raojiacui@gmail.com" }, updatedAt: now, version: "1" };
    const signature = createHmac("sha256", localSecret).update(JSON.stringify({ ...session, expiresAt })).digest("base64url");
    await context.addCookies([{ name: "better-auth.session_data", value: Buffer.from(JSON.stringify({ session, expiresAt, signature })).toString("base64url"), domain: "localhost", path: "/" }]);
  }
  let interrupted = false;
  let observedDiagnostics = false;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/commercial/tasks/${id}`) {
      observedDiagnostics ||= url.searchParams.get("diagnostics") === "1";
      if (interrupted) { await route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } }); return; }
      await route.fulfill({ json: { id, kind: "analysis", state: "running", credits: 27, diagnostics: { taskId: id, state: "running", stage: "analyzing", modelId: "gemini-3-8-flash-openai", createdAt: now - 360000, updatedAt: now - 180000, observedAt: now, scenes: [
        { index: 1, stage: "completed", queueMs: 2000, preparationMs: 18000, modelMs: 90000, saveMs: 2000 },
        { index: 2, stage: "analyzing", queueMs: 2000, preparationMs: 22000, startedAt: now - 120000 },
        { index: 3, stage: "queued" },
      ] } } }); return;
    }
    await route.fulfill({ json: url.pathname.includes("/auth/get-session") ? { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", expiresAt: new Date(now + 3600000).toISOString() } } : {} });
  });
  await page.goto(`/billing/tasks/${id}`);
  const details = page.getByTestId("analysis-task-details");
  await expect(details).toBeVisible();
  await expect(details.getByText("后台最近更新", { exact: true })).toBeVisible();
  await expect(details.getByText("等待模型返回", { exact: true })).toHaveCount(1);
  await expect(details.getByText("等待调度", { exact: true })).toBeVisible();
  await expect(details.getByText("1:30", { exact: true })).toBeVisible();
  expect(observedDiagnostics).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/task-diagnostics-${width}.png`, fullPage: true });
  interrupted = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(details.getByRole("alert")).toContainText("状态同步中断");
  await expect(details.getByText("1:30", { exact: true })).toBeVisible();
  interrupted = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(details.getByRole("alert")).toHaveCount(0);
});
