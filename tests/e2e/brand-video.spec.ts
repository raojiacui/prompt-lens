import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`docs and brand film navigation at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    await page.goto("/");
    const header = page.locator("header");
    if (width < 768) await header.getByRole("button", { name: "Toggle menu" }).click();
    await expect(header.getByRole("link", { name: "文档", exact: true })).toHaveAttribute("href", "/guide");
    await expect(header.getByRole("link", { name: /文章|博客/ })).toHaveCount(0);
    await header.getByRole("button", { name: "视频", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Prompt Lens 宣传视频" });
    await expect(modal).toBeVisible();
    await expect(modal.locator("video")).toHaveAttribute("src", "/brand-video/prompt-lens-final.mp4");
    await expect.poll(() => modal.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => modal.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
    const box = await modal.locator("video").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await modal.getByRole("button", { name: "关闭视频" }).click();
    await expect(modal).toHaveCount(0);
    await header.getByRole("button", { name: "视频", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await header.getByRole("link", { name: "文档", exact: true }).click();
    await expect(page.getByRole("heading", { name: "完整使用教程", exact: true })).toBeVisible();
  });
}
