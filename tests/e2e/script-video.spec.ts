import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { compileScriptVideo } from "../../lib/workflow/script-video-compiler";
const projectId = "11111111-1111-4111-8111-111111111111", versionId = "22222222-2222-4222-8222-222222222222";
const sceneId = "33333333-3333-4333-8333-333333333333", generationId = "44444444-4444-4444-8444-444444444444";
test.beforeEach(async ({ context, baseURL }) => {
  const secret = process.env.SCRIPT_UI_TEST_AUTH_SECRET;
  if (!secret) return;
  const hostname = new URL(baseURL!).hostname; expect(["localhost", "127.0.0.1"]).toContain(hostname);
  const expiresAt = Date.now() + 3600000;
  const session = { session: { id: "isolated-script-video", userId: "owner", token: "local-only", expiresAt: new Date(expiresAt).toISOString() }, user: { id: "owner", name: "Test", email: "raojiacui@gmail.com" }, updatedAt: Date.now(), version: "1" };
  const signature = createHmac("sha256", secret).update(JSON.stringify({ ...session, expiresAt })).digest("base64url");
  await context.addCookies([{ name: "better-auth.session_data", value: Buffer.from(JSON.stringify({ session, expiresAt, signature })).toString("base64url"), domain: hostname, path: "/" }]);
});
async function fixture(page: Page) {
  const content = { title: "Thirty-second story", summary: "A traveler crosses the lake and enters a snowy palace.", globalStyle: "cinematic", characters: "One traveler in white", continuityNotes: "Keep the same costume", scenes: [{ id: sceneId, sceneIndex: 1, startMs: 0, endMs: 30000, text: "Wide establishing shot of the lake. Track the traveler towards the snowy palace, then cut to the palace entrance." }] };
  const document = { revision: 1, content, savedAt: new Date().toISOString(), history: [], candidates: [] };
  const calls = { previews: 0, submits: 0, canGenerate: true, unknown: false, expired: false, result: "generating" };
  let job: Record<string, unknown> | null = null;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); const path = url.pathname; let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "owner", name: "Test", email: "raojiacui@gmail.com", role: "user" }, session: { id: "local", token: "local-only", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
    else if (path === "/api/credits/me") body = { balance: 0, mode: "byok", hasUserApiKey: true, trial: { remaining: 0 }, commercial: { enabled: true, credits: 200, rewrites: 20 } };
    else if (path === "/api/models") body = { models: [] };
    else if (path === "/api/workflow/projects") body = { projects: [{ id: projectId, title: content.title, status: "ready", updatedAt: new Date().toISOString(), activeVersionId: versionId }] };
    else if (path === `/api/workflow/projects/${projectId}`) {
      const version = { id: versionId, label: "Original", versionNumber: 1, kind: "original", overview: { narrative: content.summary } };
      const scene = { id: sceneId, originalSceneId: sceneId, projectVersionId: versionId, sceneIndex: 1, story: { summary: content.summary }, visual: {}, dialogue: [], subtitle: [], audio: {}, transition: {}, generationPrompt: content.scenes[0].text, duration: 30 };
      body = { project: { id: projectId, title: content.title, status: "ready", activeVersionId: versionId }, versions: [version], activeVersion: version, scenes: [{ id: sceneId, sceneIndex: 1, startTime: 0, endTime: 30, duration: 30, status: "completed", keyframeUrls: [] }], sceneVersions: [scene], allSceneVersions: [scene] };
    } else if (path.endsWith("/script/video")) {
      if (route.request().method() === "GET") body = job;
      else {
        const input = route.request().postDataJSON();
        if (input.action === "preview") {
          calls.previews++;
          try {
            const compiled = compileScriptVideo(content, input.settings, input.editedPrompt);
            body = { token: "signed-local-fixture", canGenerate: calls.canGenerate, payload: compiled.payload, snapshot: { generationId, projectId, versionId, revision: 1, expiresAt: Date.now() + 600000, prompt: compiled.prompt, settings: input.settings } };
          } catch { await route.fulfill({ status: 400, json: { code: "SCRIPT_VIDEO_TOO_LONG", error: "The source exceeds the selected duration; no truncation." } }); return; }
        } else {
          calls.submits++;
          expect(input).toEqual({ action: "submit", token: "signed-local-fixture", confirmedCost: true });
          if (calls.expired) { calls.expired = false; await route.fulfill({ status: 409, json: { code: "SCRIPT_VIDEO_PREVIEW_EXPIRED", error: "Preview expired" } }); return; }
          job = { generationId, providerTaskId: calls.unknown ? null : "supplier-task", status: "processing", stage: calls.unknown ? "unknown_submission" : "queued", error: calls.unknown ? "Submission unconfirmed; check the KIE console." : null };
          if (calls.unknown) { await route.abort("internetdisconnected"); return; }
          body = job;
        }
      }
    } else if (path.endsWith("/script")) body = document;
    else if (path === "/api/generation-jobs") body = { status: calls.result, stage: calls.result === "review" ? "reviewing_output" : undefined, videoUrl: calls.result === "success" ? "/remotion/remix-flow/rewrite-before.mp4" : undefined };
    await route.fulfill({ json: body });
  });
  return calls;
}
async function open(page: Page, zh: boolean) {
  await page.goto("/dashboard?tab=analyze");
  await page.getByRole("button", { name: /Thirty-second story/ }).click();
  const script = page.getByTestId("full-video-script");
  await expect(script).toBeVisible();
  const expand = script.getByRole("button", { name: zh ? "展开完整脚本" : "Expand full script", exact: true });
  if (await expand.isVisible()) await expand.click();
  await script.getByRole("button", { name: zh ? "预览并生成长视频" : "Preview and generate video", exact: true }).click();
  return page.getByRole("region", { name: zh ? "完整脚本生成长视频" : "Generate full-script video", exact: true });
}
for (const locale of ["zh", "en"]) for (const width of [1440, 390]) test(`script to 30-second video ${locale} ${width}`, async ({ page, context }) => {
  const zh = locale === "zh";
  await page.setViewportSize({ width, height: 1000 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
  const calls = await fixture(page); const panel = await open(page, zh);
  expect(calls.submits).toBe(0);
  await expect(panel.getByLabel(zh ? "长视频时长" : "Video duration", { exact: true })).toHaveValue("30");
  await panel.getByRole("button", { name: zh ? "生成提示词预览" : "Preview prompt", exact: true }).click();
  const prompt = panel.getByLabel(zh ? "长视频实际提示词" : "Actual video prompt", { exact: true });
  await expect(prompt).toHaveValue(/SHOT 1/);
  await expect(prompt).toHaveValue(/00:30.000/);
  const confirm = panel.getByRole("button", { name: zh ? "确认生成 30 秒视频" : "Generate 30-second video", exact: true });
  await expect(confirm).toBeDisabled();
  await prompt.fill("A 30-second, two-shot story with the same traveler and a snowy palace.");
  await expect(confirm).toBeDisabled();
  await panel.getByRole("button", { name: zh ? "更新提示词预览" : "Update prompt preview", exact: true }).click();
  await panel.getByLabel(zh ? "确认 KIE 费用" : "Confirm KIE charges", { exact: true }).check();
  await expect(confirm).toBeEnabled();
  expect(calls.submits).toBe(0);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/script-video-preview-${locale}-${width}.png`, fullPage: true });
  await confirm.click();
  await expect(panel.getByTestId("generation-task-progress")).toBeVisible();
  expect(calls.submits).toBe(1);
  calls.result = "review";
  await panel.getByRole("button", { name: zh ? "查询当前任务" : "Retrieve current task", exact: true }).click();
  await expect(panel.locator("video")).toHaveCount(0);
  calls.result = "success";
  await panel.getByRole("button", { name: zh ? "查询当前任务" : "Retrieve current task", exact: true }).click();
  await expect(panel.locator("video")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.reload();
  const restored = await open(page, zh);
  await expect(restored.locator("video")).toBeVisible();
  expect(calls.submits).toBe(1);
});
test("unknown submission is retrieved after reload without another paid call", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const calls = await fixture(page); calls.unknown = true;
  const panel = await open(page, true);
  await panel.getByRole("button", { name: "生成提示词预览", exact: true }).click();
  await panel.getByLabel("确认 KIE 费用", { exact: true }).check();
  await panel.getByRole("button", { name: "确认生成 30 秒视频", exact: true }).click();
  await expect(panel.getByTestId("generation-task-progress")).toBeVisible();
  await page.reload();
  const restored = await open(page, true);
  await expect(restored.getByText("Submission unconfirmed; check the KIE console.", { exact: true })).toBeVisible();
  expect(calls.submits).toBe(1);
  await expect(restored.getByRole("button", { name: "准备新的生成", exact: true })).toHaveCount(0);
});
test("missing KIE key and timeline overflow do not create supplier tasks", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const calls = await fixture(page); calls.canGenerate = false;
  const panel = await open(page, true);
  await panel.getByRole("button", { name: "生成提示词预览", exact: true }).click();
  await expect(panel.getByLabel("确认 KIE 费用", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "确认生成 30 秒视频", exact: true })).toBeDisabled();
  await panel.getByLabel("长视频时长", { exact: true }).selectOption("15");
  await panel.getByRole("button", { name: "更新提示词预览", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("no truncation");
  expect(calls.submits).toBe(0);
});
