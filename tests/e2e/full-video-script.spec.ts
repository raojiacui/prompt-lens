import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import type { FullVideoScript, ScriptDocument } from "../../lib/workflow/full-video-script";

const projectId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
test.beforeEach(async ({ context, baseURL }) => {
  const secret = process.env.SCRIPT_UI_TEST_AUTH_SECRET;
  if (!secret) return;
  const hostname = new URL(baseURL!).hostname;
  expect(["localhost", "127.0.0.1"]).toContain(hostname);
  const expiresAt = Date.now() + 3600000;
  const session = { session: { id: "isolated-script-ui", userId: "owner", token: "local-only", expiresAt: new Date(expiresAt).toISOString() }, user: { id: "owner", name: "Local test", email: "raojiacui@gmail.com" }, updatedAt: Date.now(), version: "1" };
  const signature = createHmac("sha256", secret).update(JSON.stringify({ ...session, expiresAt })).digest("base64url");
  await context.addCookies([{ name: "better-auth.session_data", value: Buffer.from(JSON.stringify({ session, expiresAt, signature })).toString("base64url"), domain: hostname, path: "/" }]);
});
async function fixture(page: Page, locale: string) {
  const summary = locale === "zh" ? "白衣人物在湖面乘舟前行，远处山峦起伏。" : "A person in white crosses the lake in a boat beneath distant mountains.";
  let document: ScriptDocument = { revision: 1, savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), history: [], candidates: [], content: {
    title: "Full script example", summary: Array(6).fill(summary).join("\n\n"), globalStyle: "Cinematic", characters: "A person in white", continuityNotes: "Existing AI analysis; verify inferred details.",
    scenes: [{ id: firstId, sceneIndex: 1, startMs: 250, endMs: 2750, text: `${summary}\n${"Camera follows the boat. ".repeat(8)}` }, { id: secondId, sceneIndex: 2, startMs: 4120, endMs: 6990, text: "The camera reveals a distant palace." }],
  } };
  const calls = { reads: 0, saves: [] as Record<string, unknown>[], rewrites: [] as Record<string, unknown>[], conflict: false, offline: false, delaySaveMs: 0, unknownRewrite: false };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); const path = url.pathname;
    let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "owner", email: "test@example.com", name: "Test", role: "user" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
    else if (path === "/api/credits/me") body = { balance: 0, mode: "byok", hasUserApiKey: true, trial: { limit: 2, used: 0, remaining: 2, isAdmin: false }, commercial: { enabled: true, credits: 200, rewrites: 20 } };
    else if (path === "/api/models") body = { models: [] };
    else if (path === "/api/workflow/projects") body = { projects: [{ id: projectId, title: "Full script example", status: "ready", activeVersionId: versionId, updatedAt: new Date().toISOString() }] };
    else if (path === `/api/workflow/projects/${projectId}`) {
      const version = { id: versionId, label: "Original", versionNumber: 1, kind: "original", overview: { narrative: Array(8).fill(summary).join("\n\n") } };
      const sceneVersions = document.content.scenes.map(s => ({ id: s.id, originalSceneId: s.id, projectVersionId: versionId, sceneIndex: s.sceneIndex, story: { summary }, visual: { sceneDescription: summary }, dialogue: [], subtitle: [], audio: {}, transition: {}, generationPrompt: summary, duration: 2.5 }));
      body = { project: { id: projectId, title: "Full script example", status: "ready", activeVersionId: versionId }, versions: [version], activeVersion: version,
        scenes: document.content.scenes.map(s => ({ id: s.id, sceneIndex: s.sceneIndex, startTime: s.startMs / 1000, endTime: s.endMs / 1000, duration: 2.5, status: "completed", keyframeUrls: [] })), sceneVersions, allSceneVersions: sceneVersions };
    } else if (path.endsWith("/script/rewrite")) {
      const input = route.request().postDataJSON(); calls.rewrites.push(input);
      if (calls.unknownRewrite) { calls.unknownRewrite = false; await route.fulfill({ status: 503, json: { final: false, error: "Unable to confirm; retrieve the same request" } }); return; }
      const content: FullVideoScript = { ...document.content, scenes: document.content.scenes.map(s => input.sceneIds.length && !input.sceneIds.includes(s.id) ? s : { ...s, text: "A snowy field with the same character and camera movement." }) };
      const candidate = { requestId: input.requestId, fingerprint: "fixture", sourceRevision: input.revision, sceneIds: input.sceneIds, content };
      document.candidates.push(candidate); body = { candidate };
    } else if (path.endsWith("/script")) {
      if (route.request().method() === "PUT") {
        const input = route.request().postDataJSON(); calls.saves.push(input);
        if (calls.delaySaveMs) await new Promise(resolve => setTimeout(resolve, calls.delaySaveMs));
        if (calls.offline) { await route.abort("internetdisconnected"); return; }
        if (calls.conflict) { calls.conflict = false; document.revision++; await route.fulfill({ status: 409, json: { code: "SCRIPT_CONFLICT", error: "A newer revision exists", final: true } }); return; }
        const old = { revision: document.revision, savedAt: document.savedAt, content: document.content };
        document = { ...document, revision: document.revision + 1,
          content: input.action === "save" ? input.content : input.action === "apply" ? document.candidates.find(c => c.requestId === input.candidateId)!.content : document.history.at(-1)!.content,
          history: [...document.history, old] };
        body = document;
      } else if (url.searchParams.has("format")) {
        await route.fulfill({ contentType: "text/plain", headers: { "Content-Disposition": 'attachment; filename="script.txt"' }, body: JSON.stringify(document.content) }); return;
      } else { calls.reads++; body = document; }
    }
    await route.fulfill({ json: body });
  });
  return calls;
}
async function open(page: Page, locale: string) {
  await page.goto("/dashboard?tab=analyze");
  await page.getByRole("button", { name: /Full script example/ }).click();
  const panel = page.getByTestId("full-video-script");
  await panel.getByRole("button", { name: locale === "zh" ? "展开完整脚本" : "Expand full script", exact: true }).click();
  await expect(panel.getByLabel(locale === "zh" ? "镜头 2 脚本" : "Scene 2 script", { exact: true })).toBeVisible();
  return panel;
}

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`full script edit, AI confirmation and download ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    const calls = await fixture(page, locale);
    await page.goto("/dashboard?tab=analyze");
    await page.getByRole("button", { name: /Full script example/ }).click();
    const panel = page.getByTestId("full-video-script");
    await expect(panel.getByRole("button", { name: locale === "zh" ? "展开完整脚本" : "Expand full script", exact: true })).toHaveAttribute("aria-expanded", "false");
    expect(calls.reads).toBe(0);
    await panel.getByRole("button", { name: locale === "zh" ? "展开完整脚本" : "Expand full script", exact: true }).click();
    const editor = panel.getByLabel(locale === "zh" ? "镜头 2 脚本" : "Scene 2 script", { exact: true });
    await expect(editor).toBeVisible();
    await editor.fill("The palace glows in warm light.\n" + "A detailed continuation. ".repeat(30));
    await expect.poll(() => calls.saves.length).toBe(1);
    await expect(panel.getByRole("status")).toContainText(locale === "zh" ? "已保存" : "Saved");
    const editorSize = await editor.evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight }));
    expect(editorSize.scrollHeight).toBeLessThanOrEqual(editorSize.height + 2);
    await panel.getByLabel(locale === "zh" ? "脚本改写范围" : "Script rewrite scope").selectOption("selected");
    await panel.getByRole("checkbox", { name: locale === "zh" ? "镜头 2" : "Scene 2", exact: true }).check();
    await panel.getByLabel(locale === "zh" ? "完整脚本 AI 改写要求" : "Full script AI rewrite instructions").fill("Set the second scene in a snowfield, preserve the camera.");
    await panel.getByRole("button", { name: locale === "zh" ? "发送改写要求" : "Send rewrite", exact: true }).click();
    const suggestions = panel.getByLabel(locale === "zh" ? "AI 修改建议" : "AI suggestions", { exact: true });
    await expect(suggestions).toBeVisible();
    expect(calls.rewrites[0]).toMatchObject({ sceneIds: [secondId], payer: "included", revision: 2 });
    await expect(editor).not.toHaveValue(/snowy field/);
    await suggestions.getByRole("button", { name: locale === "zh" ? "应用修改" : "Apply changes", exact: true }).click();
    await expect(editor).toHaveValue(/snowy field/);
    const download = panel.getByRole("button", { name: locale === "zh" ? "导出完整脚本" : "Export full script", exact: true });
    await download.hover();
    await expect(panel.getByRole("tooltip")).toContainText(locale === "zh" ? "导出完整脚本" : "Export full script");
    expect(await download.textContent()).toBe("");
    await download.click();
    const downloaded = page.waitForEvent("download");
    await panel.getByRole("button", { name: locale === "zh" ? "纯文本 (.txt)" : "Plain text (.txt)", exact: true }).click();
    const file = await downloaded;
    expect(await readFile((await file.path())!, "utf8")).toContain("snowy field");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await panel.getByRole("button", { name: locale === "zh" ? "收起完整脚本" : "Collapse full script", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/full-script-${locale}-${width}.png`, fullPage: true });
    await panel.getByRole("button", { name: locale === "zh" ? "收起完整脚本" : "Collapse full script", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await panel.getByRole("button", { name: locale === "zh" ? "展开完整脚本" : "Expand full script", exact: true }).click();
    expect(calls.reads).toBe(1);
    await expect(editor).toHaveValue(/snowy field/);
  });
}

test("offline draft restoration and explicit conflict resolution", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const calls = await fixture(page, "zh");
  const panel = await open(page, "zh");
  calls.offline = true;
  const editor = panel.getByLabel("镜头 2 脚本", { exact: true });
  await editor.fill("断网仍要保留的文字");
  await expect(panel.getByRole("status")).toContainText("保存失败");
  await page.reload();
  await page.getByRole("button", { name: /Full script example/ }).click();
  await expect(editor).toHaveValue("断网仍要保留的文字");
  await expect(panel.getByRole("status")).toContainText("保存失败");
  calls.offline = false; calls.conflict = true;
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("编辑冲突");
  page.once("dialog", dialog => dialog.accept());
  await panel.getByRole("button", { name: "保留本机稿并保存", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("已保存");
  await expect(editor).toHaveValue("断网仍要保留的文字");
});

test("edits made during an in-flight autosave are saved as the next revision", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const calls = await fixture(page, "zh");
  const panel = await open(page, "zh");
  calls.delaySaveMs = 1600;
  const editor = panel.getByLabel("镜头 2 脚本", { exact: true });
  await editor.fill("第一段编辑");
  await expect(panel.getByRole("status")).toContainText("保存中");
  await editor.fill("保存中继续写的第二段编辑");
  await expect.poll(() => calls.saves.length, { timeout: 10000 }).toBe(2);
  await expect(panel.getByRole("status")).toContainText("已保存");
  expect(calls.saves[1].revision).toBe(2);
  expect((calls.saves[1].content as FullVideoScript).scenes[1].text).toBe("保存中继续写的第二段编辑");
});

test("unknown rewrite responses preserve the original request ID for retrieval", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const calls = await fixture(page, "zh");
  const panel = await open(page, "zh");
  calls.unknownRewrite = true;
  const input = panel.getByLabel("完整脚本 AI 改写要求");
  await input.fill("场景改为雪原");
  await panel.getByRole("button", { name: "发送改写要求", exact: true }).click();
  await expect(panel.getByRole("button", { name: "查询改写结果", exact: true })).toBeEnabled();
  await expect(input).toBeDisabled();
  await panel.getByRole("button", { name: "查询改写结果", exact: true }).click();
  await expect(panel.getByLabel("AI 修改建议", { exact: true })).toBeVisible();
  expect(calls.rewrites).toHaveLength(2);
  expect(calls.rewrites[0]).toEqual(calls.rewrites[1]);
  await panel.getByRole("button", { name: "拒绝建议", exact: true }).click();
  await expect(panel.getByLabel("AI 修改建议", { exact: true })).not.toBeVisible();
  await expect(panel.getByLabel("镜头 2 脚本", { exact: true })).toHaveValue("The camera reveals a distant palace.");
});
