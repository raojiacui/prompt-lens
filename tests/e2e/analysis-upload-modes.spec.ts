import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { modelRegistry } from "../../lib/ai/model-registry";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) for (const paid of [true, false]) {
  test(`${paid ? "paid" : "free"} upload modes ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let modelRequests = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, mode: paid ? "trial" : "byok", hasUserKieKey: !paid, balance: 0, commercial: { credits: paid ? 650 : 0 }, trial: { remaining: 0, isAdmin: false } };
      else if (path === "/api/workflow/projects") body = { projects: [] };
      else if (path === "/api/models") { modelRequests++; body = { models: [] }; }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze");
    await expect(page.locator('select option[value="auto"]')).toHaveCount(0);
    await expect(page.getByLabel(locale === "zh" ? "分析模型" : "Analysis model")).toHaveValue("analysis-gemini-3-8-flash");
    const expectedModels = modelRegistry.filter(model => model.category === "analysis" && model.enabled);
    await expect(page.getByLabel(locale === "zh" ? "分析模型" : "Analysis model").locator("option")).toHaveText(expectedModels.map(model => model.displayName));
    expect(modelRequests).toBe(0);
    await expect(page.locator("option").filter({ hasText: /Gemini 2\.5 Pro/i })).toHaveCount(0);
    await expect(page.getByText(locale === "zh" ? "选择视频或图片" : "Choose a video or image", { exact: true })).toBeVisible();
    await expect(page.getByText(locale === "zh" ? "视频文件最大 100MB，不限制时长。" : "Video files up to 100MB, with no duration limit.")).toBeVisible();
    const whole = page.getByRole("radio", { name: locale === "zh" ? "整段分析" : "Whole video", exact: true });
    const split = page.getByRole("radio", { name: locale === "zh" ? "拆镜分析" : "Split shots", exact: true });
    if (paid) {
      await expect(split).toBeEnabled();
      await expect(split).toBeChecked();
      await whole.check();
      await expect(whole).toBeChecked();
      await split.check();
      await expect(page.getByText(locale === "zh" ? "拆镜使用平台积分，拆分后可选择要分析的镜头。" : "Splitting uses platform credits. Choose shots to analyze after splitting.")).toBeVisible();
    } else {
      await expect(whole).toBeChecked();
      await expect(split).toBeDisabled();
      await expect(page.getByText(locale === "zh" ? /拆镜需购买平台积分；配置自己的 Key 可直接整段分析/ : /Shot splitting requires purchased platform credits; your own Key can be used for whole-video analysis/)).toBeVisible();
    }
    await expect(page.getByText(locale === "zh" ? /付费分析不限视频时长/ : /Paid analysis has no source-duration cap/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/upload-modes-${paid ? "paid" : "free"}-${locale}-${width}.png` });
    const videoFile = test.info().outputPath("sixty-second-upload.mp4");
    mkdirSync(path.dirname(videoFile), { recursive: true });
    const ffmpeg = createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg").path;
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=1", "-t", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoFile]);
    await page.locator('input[type="file"]').setInputFiles(videoFile);
    await expect(page.getByRole("button", { name: locale === "zh" ? "更换文件" : "Replace file", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "zh" ? "分析视频" : "Analyze video", exact: true })).toBeEnabled();
    await expect.poll(() => page.locator("video").first().evaluate(video => (video as HTMLVideoElement).duration)).toBe(60);
  });
}
