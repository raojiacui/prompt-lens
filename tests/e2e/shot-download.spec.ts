import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

let sourceVideo: Buffer;
let shotVideo: Buffer;
test.beforeAll(async ({}, info) => {
  const source = info.outputPath("source.mp4");
  const shot = info.outputPath("shot.mp4");
  await mkdir(dirname(source), { recursive: true });
  const ffmpeg = createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg").path;
  execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=red:s=320x180:r=10:d=2", "-f", "lavfi", "-i", "color=blue:s=320x180:r=10:d=8", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", source], { stdio: "ignore" });
  execFileSync(ffmpeg, ["-y", "-ss", "2", "-i", source, "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", shot], { stdio: "ignore" });
  sourceVideo = await readFile(source); shotVideo = await readFile(shot);
});

for (const width of [1440, 390]) test(`download split shot without billing ${width}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const projectId = "11111111-1111-4111-8111-111111111111";
  const preparationId = "22222222-2222-4222-8222-222222222222";
  const splitId = "33333333-3333-4333-8333-333333333333";
  const scenes = [{ id: "1", startUs: 0, endUs: 2000000 }, { id: "2", startUs: 2000000, endUs: 10000000 }];
  let confirmations = 0;

  await page.route("**/fixtures/*.mp4*", async route => {
    const bytes = route.request().url().includes("source.mp4") ? sourceVideo : shotVideo;
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
    await route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "test", name: "Test", email: "test@example.com" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
    else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, mode: "byok", hasUserKieKey: false, trial: { remaining: 0 }, commercial: { enabled: true, credits: 200, rewrites: 20 }, linkImports: { remaining: 10 } };
    else if (path === "/api/models") body = { models: [] };
    else if (path === "/api/workflow/projects") body = route.request().method() === "POST" ? { project: { id: projectId } } : { projects: [] };

    else if (path === "/api/media/resolve-link") body = { mediaUrl: "http://localhost:3000/fixtures/source.mp4", filename: "source.mp4", mediaType: "video", platform: "douyin", duration: 10 };
    else if (path === "/api/commercial/analysis") {
      const input = route.request().postDataJSON();
      if (input.action === "prepare") body = { id: preparationId, durationUs: 10000000, scenes };
      else body = { id: "quote", credits: 8, splitCredits: 2, analysisCredits: 6 };
    } else if (path.startsWith("/api/commercial/tasks/")) { confirmations++; body = {}; } else if (path === `/api/commercial/analysis/${preparationId}/shots/2`) {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({ contentType: "video/mp4", headers: { "Content-Disposition": 'attachment; filename="shot-02.mp4"' }, body: shotVideo }); return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/dashboard?tab=analyze");
  await page.getByRole("tab", { name: "粘贴链接" }).click();
  await page.getByLabel("视频链接", { exact: true }).fill("https://v.douyin.com/test/");
  await page.getByTestId("analysis-action-row").getByRole("button").click();
  const panel = page.getByRole("region", { name: "镜头选择与费用" });
  await panel.getByRole("button", { name: "读取视频信息" }).click();
  const card = panel.getByRole("article", { name: "镜头 2", exact: true });
  const downloadEvent = page.waitForEvent("download");
  await card.getByRole("button", { name: "下载镜头" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("shot-02.mp4");
  const bytes = await readFile((await download.path())!);
  expect(bytes.equals(shotVideo)).toBe(true);
  const media = await page.evaluate(async base64 => {
    const video = document.createElement("video"); video.muted = true;
    const objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], { type: "video/mp4" }));
    video.src = objectUrl;
    document.body.appendChild(video);
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error("Unreadable clip")); });
    await video.play();
    await new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
    video.pause();
    const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(video, 0, 0, 1, 1);
    const result = { duration: video.duration, pixels: Array.from(ctx.getImageData(0, 0, 1, 1).data) };
    URL.revokeObjectURL(objectUrl);
    video.remove();
    return result;
  }, bytes.toString("base64"));
  expect(media.duration).toBeCloseTo(8, 1);
  expect(media.pixels[2]).toBeGreaterThan(200);
  expect(media.pixels[0]).toBeLessThan(20);
  expect(confirmations).toBe(0);
  await expect(card.getByRole("button", { name: "下载镜头", exact: true })).toBeVisible();
  const secondDownload = page.waitForEvent("download");
  await card.getByRole("button", { name: "下载镜头", exact: true }).click();
  await secondDownload;
  expect(confirmations).toBe(0);
  await panel.getByRole("button", { name: "获取报价" }).click();
  await expect(panel.getByText("拆镜 2 + 分析 6。确认后预留，按成功结果结算。", { exact: true })).toBeVisible();
  await card.screenshot({ path: `test-results/download-shot-${width}.png` });

});
