import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`landing navigation, link FAQ and guide at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    await page.route("**/api/**", route => route.fulfill({ json: {} }));
    await page.goto("/");
    await expect(page.getByRole("link", { name: "参观样例", exact: true }).first()).toHaveAttribute("href", "/samples");
    const footer = page.locator("footer");
    await expect(footer.getByRole("heading", { name: "公司", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("heading", { name: "Company", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "完整使用教程" })).toHaveAttribute("href", "/guide");
    await expect(footer.locator('a[href="mailto:489543971@qq.com"]')).toHaveCount(1);
    await expect(footer.locator('a[href="#"], a[href="#articles"], a[href="#blog"]')).toHaveCount(0);
    await page.getByRole("button", { name: "粘贴视频链接时，可以直接粘贴整段分享文本吗？" }).click();
    await expect(page.getByText("完整网址示例", { exact: true })).toBeVisible();
    await expect(page.getByText("视频分享文本示例", { exact: true })).toBeVisible();
    const shareExample = page.locator("#faq code").last();
    await expect(shareExample).toBeVisible();
    expect(await shareExample.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await footer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/footer-guide-${width}.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await footer.getByRole("link", { name: "完整使用教程" }).click();
    await expect(page.getByRole("heading", { name: "完整使用教程", exact: true })).toBeVisible();
    await expect(page.locator("main section")).toHaveCount(11);
    if (width < 1024) await page.getByText("查看教程目录", { exact: true }).click();
    await page.getByRole("navigation", { name: "教程目录" }).getByRole("link", { name: /生成与下载视频/ }).click();
    await expect(page).toHaveURL(/\/guide#generate$/);
    await expect(page.getByRole("heading", { name: "生成与下载视频", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/tutorial-${width}.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
