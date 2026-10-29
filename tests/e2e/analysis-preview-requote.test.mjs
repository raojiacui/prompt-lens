import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("waiting and quote errors preserve detected shots and selection without another preparation", { timeout: 60000 }, async () => {
  const bundle = await build({
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
