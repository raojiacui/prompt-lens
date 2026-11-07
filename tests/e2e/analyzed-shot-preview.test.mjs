import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("analyzed shots retain a preview without clips and never request paid processing", async () => {
  const bundle = await build({ stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {AnalyzedShotPreview} from './components/workflow/analyzed-shot-preview';
    const scene = {id:'scene',sceneIndex:3,referenceVideoId:'ref',startTime:6.5,endTime:10.467,keyframeUrls:[]};
    createRoot(document.getElementById('root')).render(<>
      <section id="fallback"><AnalyzedShotPreview scene={scene} references={[{id:'ref',sourceUrl:'https://preview.test/source.mp4'}]} zh={true}/></section>
      <section id="missing"><AnalyzedShotPreview scene={{...scene,id:'missing'}} references={[{id:'other',sourceUrl:'https://preview.test/wrong.mp4'}]} zh={true}/></section>
      <section id="clip"><AnalyzedShotPreview scene={{...scene,id:'clip',clipUrl:'https://preview.test/clip.mp4'}} zh={true}/></section>
      <section id="failed"><AnalyzedShotPreview scene={{...scene,id:'failed',clipUrl:'https://preview.test/broken.mp4'}} references={[{id:'ref',sourceUrl:'https://preview.test/source.mp4'}]} zh={true}/></section>
    </>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const mutations = [];
    page.on("request", request => { if (request.method() !== "GET") mutations.push(request.url()); });
    await page.route("https://preview.test/**", route => route.request().url().endsWith("/")
      ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
      : route.fulfill({ status: 404, body: "missing" }));
    await page.goto("https://preview.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("#fallback video").waitFor();
    assert.equal(await page.locator("#fallback video").getAttribute("src"), "https://preview.test/source.mp4#t=6.5,10.467");
    assert.match(await page.locator("#fallback").innerText(), /原视频分段预览/);
    assert.match(await page.locator("#missing").innerText(), /提示词已保留/);
    assert.equal(await page.locator("#missing video").count(), 0, "never substitute another reference video");
    await page.waitForFunction(() => document.querySelector('#failed video')?.getAttribute('src') === 'https://preview.test/source.mp4#t=6.5,10.467');
    assert.deepEqual(mutations, [], "preview must not submit analysis or billable processing");
  } finally { await browser.close(); }
});
