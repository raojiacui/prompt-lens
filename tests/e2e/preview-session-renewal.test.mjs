import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("shot playback and wallet polling renew expired access caches without submitting analysis", async () => {
  const output = path.resolve("tmp/preview-session-renewal");
  await mkdir(output, { recursive: true });
  const fixture = path.join(output, "video.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fixture]);
  const bytes = await readFile(fixture);
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {SceneVideoPreview} from './components/workflow/scene-video-preview';
      import {useWalletBalance} from './lib/billing/use-wallet-balance';
      function Wallet() {
        const state = useWalletBalance();
        return <output>{state.failed ? 'Wallet failed' : state.wallet ? 'Credits: '+state.wallet.credits : 'Loading wallet'}</output>;
      }
      createRoot(document.getElementById('root')).render(location.search.includes('wallet') ? <Wallet/> :
        <SceneVideoPreview mediaUrl="/video.mp4" clipRequestUrl="/api/commercial/analysis/fixture/shots/2" startUs={0} endUs={2000000} label="Shot 2" zh={false} onPlay={()=>{}}/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "isolated-auth-session", setup(builder) {
      builder.onResolve({ filter: /auth\/auth-client$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const authClient={useSession:()=>({data:{user:{id:"fixture"}}})};', loader: "js" }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ["clip-desktop", "clip-mobile", "clip-revoked", "wallet", "wallet-revoked"]) {
      const context = await browser.newContext({ viewport: { width: scenario.includes("mobile") ? 390 : 1100, height: 800 } });
      const page = await context.newPage();
      const calls = [];
      const revoked = scenario.includes("revoked");
      await page.route("https://preview.test/**", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<style>video{width:320px;height:180px}</style><div id="root"></div>' });
        if (url.pathname === "/video.mp4") {
          const range = /bytes=(\d+)-(\d*)/.exec(request.headers().range || "");
          const start = range ? Number(range[1]) : 0;
          const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
          return route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
        }
        calls.push({ path: url.pathname, method: request.method() });
        if (url.pathname === "/api/session-refresh") {
          assert.equal(request.method(), "POST");
          return route.fulfill(revoked ? { status: 401, json: { code: "AUTH_REQUIRED" } }
            : { json: { refreshed: true }, headers: { "Set-Cookie": "preview-session=fresh; Path=/; Secure; SameSite=Lax" } });
        }
        if (!request.headers().cookie?.includes("preview-session=fresh")) return route.fulfill({ status: 401, json: { code: "ACCESS_SESSION_REFRESH_REQUIRED" } });
        if (url.pathname === "/api/payments/account") return route.fulfill({ json: { wallet: { credits: 1263, rewrites: 10, heldCredits: 0, heldRewrites: 0, frozen: false } } });
        assert.equal(url.pathname, "/api/commercial/analysis/fixture/shots/2");
        assert.equal(request.method(), "POST");
        return route.fulfill({ contentType: "video/mp4", body: bytes });
      });
      await page.goto(`https://preview.test/?${scenario}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      if (scenario.startsWith("wallet")) {
        await page.getByText(revoked ? "Wallet failed" : "Credits: 1263", { exact: true }).waitFor();
      } else {
        await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
        await page.getByRole("button", { name: "Play", exact: true }).click();
        if (revoked) await page.getByText("Shot preview could not load", { exact: true }).waitFor();
        else {
          await page.waitForFunction(() => { const v = document.querySelector("video"); return v?.src.startsWith("blob:") && v.currentTime > 0.2; });
          assert.equal(await page.getByRole("alert").count(), 0);
        }
      }
      assert.equal(calls.filter(call => call.path === "/api/session-refresh").length, 1, scenario);
      assert.equal(calls.length, revoked ? 2 : 3, "only one renewal and at most one replay");
      assert.ok(calls.every(call => ["/api/session-refresh", "/api/payments/account", "/api/commercial/analysis/fixture/shots/2"].includes(call.path)), "never create, confirm or bill an analysis task");
      await context.close();
    }
  } finally { await browser.close(); }
});
