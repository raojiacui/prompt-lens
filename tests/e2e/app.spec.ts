import { test, expect } from "@playwright/test";

test.describe("Prompt Analyzer", () => {
  test("should load home page", async ({ page }) => {
    await page.goto("/");

    // 检查页面标题
    await expect(page).toHaveTitle(/Prompt Analyzer/);

    // 检查页面内容
    await expect(page.locator("h1")).toContainText("Prompt Analyzer");
  });

  test("should navigate to dashboard", async ({ page }) => {
    await page.goto("/");

    // 点击"直接使用"按钮
    await page.click("text=直接使用");

    // 等待页面导航
    await page.waitForURL("/dashboard");

    // 检查页面包含分析标签
    await expect(page.locator("text=分析")).toBeVisible();
    await expect(page.locator("text=历史记录")).toBeVisible();
    await expect(page.locator("text=设置")).toBeVisible();
  });

  test("should show upload area", async ({ page }) => {
    await page.goto("/dashboard");

    // 检查上传区域
    await expect(page.locator("text=点击选择文件")).toBeVisible();
    await expect(page.locator("text=支持 MP4, MOV, AVI, MKV, WebM")).toBeVisible();
  });

  test("should have settings tab", async ({ page }) => {
    await page.goto("/dashboard");

    // 点击设置标签
    await page.click("text=设置");

    // 检查设置页面内容
    await expect(page.locator("text=添加 API Key")).toBeVisible();
    await expect(page.locator("text=已保存的 API Key")).toBeVisible();
  });
});
