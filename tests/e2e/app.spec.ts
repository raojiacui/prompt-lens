import { test, expect } from "@playwright/test";

test.describe("PromptLens Landing Page", () => {
  test("should load home page", async ({ page }) => {
    await page.goto("/");

    // 检查页面标题
    await expect(page).toHaveTitle(/Prompt Lens/);

    // 检查页面主标题
    await expect(page.locator("h1")).toContainText(/AI|video|prompt|视频|提示词/i);
  });

  test("should navigate to dashboard from primary CTA", async ({ page }) => {
    await page.goto("/");

    // 点击主 CTA 按钮
    await page.click("text=Get Started");

    // 等待页面导航（已登录用户会到 dashboard，未登录会到 login）
    await page.waitForURL(/\/(dashboard|login)/);
  });

  test("should show dashboard analyze workspace", async ({ page }) => {
    await page.goto("/dashboard?tab=analyze");

    // 检查分析工作区文本
    await expect(page.locator("text=Turn your video into clear creative direction.")).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Upload a video or image to start"]')).toBeVisible();
  });

  test("should have settings tab", async ({ page }) => {
    await page.goto("/dashboard?tab=settings");

    // 检查设置页面内容
    await expect(page.locator("text=Add API Key")).toBeVisible();
    await expect(page.locator("text=Saved API Keys")).toBeVisible();
  });
});
