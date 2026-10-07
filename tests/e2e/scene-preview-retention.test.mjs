import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("shot previews keep their player, frame and position when scrolled away", async () => {
  const output = path.resolve("tmp/scene-preview-retention");
  await mkdir(output, { recursive: true });
  const fixture = path.join(output, "preview.mp4");
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fixture]);
  const bytes = await readFile(fixture);
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {SceneVideoPreview} from './components/workflow/scene-video-preview';
      createRoot(document.getElementById('root')).render(<div id="scroll">
        {Array.from({length: 8}, (_, index) => <article key={index}>
          <SceneVideoPreview mediaUrl="https://preview.test/video.mp4" startUs={1000000} endUs={5000000} label={'Shot '+index} zh={false} onPlay={() => {}} />
        </article>)}
      </div>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1100, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.route("https://preview.test/", route => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
      await page.goto("https://preview.test/");
      await page.route("https://preview.test/video.mp4", async (route) => {
        const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        await route.fulfill({ status: range ? 206 : 200, body: bytes.subarray(start, end + 1), headers: {
          "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=3600",
          ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        } });
      });
      await page.setContent(`<style>
        body{margin:0} #scroll{height:420px;overflow:auto;width:min(640px,100%)}
        article{margin-bottom:24px} [role=group]{position:relative;aspect-ratio:16/9;background:black;color:white}
        video{width:100%;height:100%;object-fit:contain} [role=status]{position:absolute;top:45%;left:45%}
        button{height:36px} input{width:100%}
      </style><div id="root"></div>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const first = page.getByRole("group", { name: "Shot 0", exact: true });
      await first.getByRole("button", { name: "Play", exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
      assert.ok(await page.locator("video").count() < 8, "distant shots must not all load at once");
      await page.evaluate(() => {
        window.savedPlayer = document.querySelector("video");
        window.savedPlayer.currentTime = 2;
      });
      await page.waitForFunction(() => !window.savedPlayer.seeking);
      await first.getByRole("button", { name: "Play", exact: true }).click();
      await page.waitForFunction(() => !window.savedPlayer.paused);
      await page.evaluate(() => { document.getElementById("scroll").scrollTop = 1500; });
      await page.waitForFunction(() => window.savedPlayer.paused);
      const position = await page.evaluate(() => window.savedPlayer.currentTime);
      await page.evaluate(() => { document.getElementById("scroll").scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector("video") === window.savedPlayer);
      assert.equal(await page.evaluate(() => window.savedPlayer.currentTime), position);
      assert.equal(await first.getByRole("status").count(), 0, "returning must not reset loading state");
      assert.equal(await page.evaluate(() => window.savedPlayer.paused), true);
      const pixels = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 18;
        const context = canvas.getContext("2d"); context.drawImage(window.savedPlayer, 0, 0, 32, 18);
        return [...context.getImageData(0, 0, 32, 18).data].filter((v, i) => i % 4 !== 3 && v > 20).length;
      });
      assert.ok(pixels > 100, "retained video frame must not be blank");
      await page.screenshot({ path: path.join(output, `preview-${viewport.width}.png`) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
