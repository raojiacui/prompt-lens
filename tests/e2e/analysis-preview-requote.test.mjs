import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

async function buildPanel() {
  return build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {AnalysisQuotePanel} from './components/payments/analysis-quote-panel';
      function Harness() {
        const [shots,setShots]=React.useState([]);
        const receive=b=>setShots(b.sceneVersions);
        return <><AnalysisQuotePanel
        source={{projectId:'project',mediaUrl:'https://preview.test/source.mp4',mediaName:'Reference',outputLanguage:'zh',automaticSplit:true}}
        onClose={()=>{}} onPartial={receive} onComplete={receive} />
        <div aria-label="Completed shots">{shots.map(s=><p key={s.id}>{s.generationPrompt}</p>)}</div></>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    alias: { "@": process.cwd() }, bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "quote-ui-fixtures", setup(builder) {
      builder.onResolve({ filter: /^next-intl$/ }, () => ({ path: "locale", namespace: "fixture" }));
      builder.onResolve({ filter: /scene-video-preview$/ }, () => ({ path: "video", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "locale"
        ? "export const useLocale=()=> 'zh';" : "export const SceneVideoPreview=()=>null;", loader: "js" }));
    } }],
  });
}

test("waiting and quote errors preserve detected shots and selection without another preparation", { timeout: 60000 }, async () => {
  const bundle = await buildPanel();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install({ time: new Date("2026-10-29T09:00:00Z") });
    await page.route("https://preview.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    const scenes = [{ id: "1", startUs: 0, endUs: 2_000_000 }, { id: "2", startUs: 2_000_000, endUs: 5_000_000 }];
    let preparations = 0;
    let failNextQuote = false;
    let confirmations = 0;
    let allowConfirmation = false;
    let finishRemaining = false;
    const quotes = [];
    await page.route("https://preview.test/api/commercial/analysis", async route => {
      const body = route.request().postDataJSON();
      if (body.action === "prepare") {
        preparations++;
        await route.fulfill({ json: { id: "saved-preparation", scenes, durationUs: 5_000_000 } });
      } else {
        quotes.push(body);
        if (failNextQuote) {
          failNextQuote = false;
          await route.fulfill({ status: 400, json: { code: "QUOTE_EXPIRED" } });
          return;
        }
        const now = await page.evaluate(() => Date.now());
        await route.fulfill({ json: { id: `quote-${quotes.length}`, credits: 4, splitCredits: 1, analysisCredits: 3, expiresAt: new Date(now + 600_000).toISOString() } });
      }
    });
    await page.route("https://preview.test/api/commercial/tasks/*", async route => {
      if (route.request().method() === "GET") {
        const versions = [{ id: "one", generationPrompt: "First shot finished" }, ...(finishRemaining ? [{ id: "two", generationPrompt: "Second shot finished" }] : [])];
        await route.fulfill({ json: { id: "running-task", state: finishRemaining ? "completed" : "running", totalScenes: 2, completedScenes: versions.length, phase: "analyzing", bundle: { sceneVersions: versions } } });
        return;
      }
      confirmations++;
      if (allowConfirmation) { await route.fulfill({ json: { id: "running-task", state: "queued" } }); return; }
      await route.fulfill({ status: 400, json: { code: "QUOTE_EXPIRED" } });
    });
    await page.goto("https://preview.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const confirm = page.getByRole("button", { name: "确认分析 · 4 积分", exact: true });
    await confirm.waitFor();
    const first = page.getByRole("checkbox", { name: "镜头 1", exact: true });
    const second = page.getByRole("checkbox", { name: "镜头 2", exact: true });
    await first.uncheck();
    await confirm.waitFor();
    assert.deepEqual(quotes.at(-1).sceneIds, ["2"]);
    for (let refresh = 0; refresh < 2; refresh++) {
      const count = quotes.length;
      const refreshedResponse = page.waitForResponse(response => response.url() === "https://preview.test/api/commercial/analysis" && response.request().postDataJSON()?.action === "quote");
      await page.clock.runFor(9 * 60_000 + 31_000);
      await refreshedResponse;
      await confirm.waitFor();
      assert.ok(quotes.length > count, "expired prices should refresh after waiting");
      assert.equal(await first.isChecked(), false);
      assert.equal(await second.isChecked(), true);
      assert.equal(preparations, 1, "waiting beyond fifteen minutes must not inspect the video again");
    }
    const confirmationRefresh = page.waitForResponse(response => response.url() === "https://preview.test/api/commercial/analysis" && response.request().postDataJSON()?.action === "quote");
    await confirm.click();
    await confirmationRefresh;
    await confirm.waitFor();
    assert.equal(confirmations, 1);
    assert.deepEqual(quotes.at(-1).sceneIds, ["2"]);
    failNextQuote = true;
    await first.check();
    const refreshCost = page.getByRole("button", { name: "重新获取费用", exact: true });
    await refreshCost.waitFor();
    assert.equal(await first.isChecked(), true, "quote errors must not clear shot selection");
    assert.equal(await second.isChecked(), true);
    assert.equal(await page.getByRole("article").count(), 2);
    await refreshCost.click();
    await confirm.waitFor();
    assert.equal(preparations, 1);
    assert.ok(quotes.every(quote => quote.preparationId === "saved-preparation"));
    assert.deepEqual([...quotes.at(-1).sceneIds].sort(), ["1", "2"]);
    allowConfirmation = true;
    await confirm.click();
    await page.getByText("First shot finished", { exact: true }).waitFor();
    assert.equal(await page.getByText("Second shot finished", { exact: true }).count(), 0, "first completed shot must display while the second is still pending");
    finishRemaining = true;
    await page.clock.runFor(4_001);
    await page.getByText("Second shot finished", { exact: true }).waitFor();
    assert.equal(preparations, 1);
    await page.close();
  } finally { await browser.close(); }
});

for (const failedAction of ["prepare", "quote"]) test(`recovers ${failedAction} preview failures using the same imported reference`, { timeout: 60000 }, async () => {
  const bundle = await buildPanel();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let preparations = 0;
    let failNextQuote = false;
    const requests = [];
    const scenes = [{ id: "1", startUs: 0, endUs: 2_000_000 }, { id: "2", startUs: 2_000_000, endUs: 5_000_000 }];
    await page.route("https://preview.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.route("https://preview.test/api/**", async route => {
      const body = route.request().postDataJSON();
      requests.push({ path: new URL(route.request().url()).pathname, body });
      assert.equal(new URL(route.request().url()).pathname, "/api/commercial/analysis", "recovery must not import a link or confirm a paid task");
      if (body.action === "prepare") {
        preparations++;
        if (preparations === 1 && failedAction === "prepare") {
          await route.fulfill({ status: 409, json: { code: "PREVIEW_PREPARATION_INTERRUPTED" } });
        } else {
          await route.fulfill({ json: { id: `preparation-${preparations}`, durationUs: 5_000_000, scenes: scenes.map(s => ({ ...s, id: preparations > 1 ? `restored-${s.id}` : s.id })) } });
        }
      } else if (failNextQuote) {
        failNextQuote = false;
        await route.fulfill({ status: 400, json: { code: "PREVIEW_EXPIRED" } });
      } else {
        await route.fulfill({ json: { id: "quote", credits: 4, splitCredits: 1, analysisCredits: 3, expiresAt: new Date(Date.now() + 600000).toISOString() } });
      }
    });
    await page.goto("https://preview.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const confirm = page.getByRole("button", { name: "确认分析 · 4 积分", exact: true });
    if (failedAction === "quote") {
      await confirm.waitFor();
      failNextQuote = true;
      await page.getByRole("checkbox", { name: "镜头 1", exact: true }).uncheck();
    }
    await confirm.waitFor();
    assert.equal(await page.getByRole("button", { name: "重新读取视频", exact: true }).count(), 0, "recoverable failures should not require another click");
    assert.equal(preparations, 2);
    const lastQuote = requests.filter(r => r.body.action === "quote").at(-1).body;
    assert.equal(lastQuote.preparationId, "preparation-2");
    assert.deepEqual(lastQuote.sceneIds, failedAction === "quote" ? ["restored-2"] : ["restored-1", "restored-2"]);
    const prepareBodies = requests.filter(r => r.body.action === "prepare").map(r => r.body);
    assert.ok(prepareBodies.every(body => body.projectId === "project" && body.mediaUrl === "https://preview.test/source.mp4"));
    assert.equal(await page.getByRole("article").count(), 2);
    await page.close();
  } finally { await browser.close(); }
});

test("preview recovery stops after two automatic retries and keeps paid execution manual", { timeout: 60000 }, async () => {
  const bundle = await buildPanel();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let preparations = 0;
    await page.route("https://preview.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.route("https://preview.test/api/**", async route => {
      assert.equal(new URL(route.request().url()).pathname, "/api/commercial/analysis");
      assert.equal(route.request().postDataJSON().action, "prepare");
      preparations++;
      await route.fulfill({ status: 409, json: { code: "PREVIEW_PREPARATION_INTERRUPTED" } });
    });
    await page.goto("https://preview.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "重新读取视频", exact: true }).waitFor();
    assert.equal(preparations, 3);
    await page.waitForTimeout(2200);
    assert.equal(preparations, 3, "recovery must not loop indefinitely");
  } finally { await browser.close(); }
});

for (const validSession of [true, false]) test(`task polling renews an expired access cache with validSession=${validSession}`, { timeout: 60000 }, async () => {
  const bundle = await buildPanel();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let confirmations = 0;
    let preparations = 0;
    let renewals = 0;
    let polls = 0;
    const scenes = [{ id: "1", startUs: 0, endUs: 5_000_000 }];
    await page.route("https://preview.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.route("https://preview.test/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/session-refresh") {
        renewals++;
        assert.equal(route.request().method(), "POST");
        assert.equal(route.request().headers().origin, "https://preview.test");
        await route.fulfill(validSession
          ? { json: { refreshed: true }, headers: { "set-cookie": "access-renewed=1; Path=/; HttpOnly; SameSite=Lax" } }
          : { status: 401, json: { code: "AUTH_REQUIRED" } });
      } else if (path === "/api/commercial/analysis") {
        if (route.request().postDataJSON().action === "prepare") {
          preparations++;
          await route.fulfill({ json: { id: "preview", durationUs: 5_000_000, scenes } });
        } else await route.fulfill({ json: { id: "original-task", credits: 4, splitCredits: 1, analysisCredits: 3 } });
      } else if (path === "/api/commercial/tasks/original-task") {
        if (route.request().method() === "POST") {
          confirmations++;
          await route.fulfill({ json: { id: "original-task", state: "queued" } });
        } else {
          polls++;
          assert.equal(new URL(route.request().url()).searchParams.get("diagnostics"), "1");
          if (polls === 1) await route.fulfill({ status: 401, json: { code: "ACCESS_SESSION_REFRESH_REQUIRED" } });
          else {
            assert.ok(route.request().headers().cookie?.includes("access-renewed=1"));
            await route.fulfill({ json: { id: "original-task", state: "completed", totalScenes: 1, completedScenes: 1,
              bundle: { sceneVersions: [{ id: "result", generationPrompt: "Original task result after session renewal" }] } } });
          }
        }
      } else assert.fail(`Unexpected request: ${path}`);
    });
    await page.goto("https://preview.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "确认分析 · 4 积分", exact: true }).click();
    if (validSession) {
      await page.getByText("Original task result after session renewal", { exact: true }).waitFor();
      assert.equal(polls, 2);
      assert.equal((await page.locator("body").innerText()).includes("登录校验失败"), false);
    } else {
      await page.getByText("登录校验失败，无法同步分析进展。请打开任务详情重新验证登录，勿重复提交分析。", { exact: true }).waitFor();
      assert.equal(polls, 1);
    }
    assert.equal(confirmations, 1, "cache renewal must never submit another paid task");
    assert.equal(preparations, 1);
    assert.equal(renewals, 1);
    await page.close();
  } finally { await browser.close(); }
});
