import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";

it.each([1440, 390])("requires confirmation and retries the same image task after a lost response at %spx", async width => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {ImageAnalysisQuotePanel} from './components/payments/image-analysis-quote-panel';createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale="zh" messages={{}}><ImageAnalysisQuotePanel source={{projectId:'project',mediaUrl:'https://storage.test/image.png',mediaName:'image.png',modelId:'analysis-gemini-3-6-flash',outputLanguage:'zh'}} onClose={()=>window.closedQuote=true} onConfirmed={id=>document.getElementById('done').textContent=id}/></NextIntlClientProvider>);`, resolveDir: process.cwd(), loader: "tsx" }, alias: { "@": process.cwd() }, bundle: true, write: false, platform: "browser", jsx: "automatic" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    const confirms: string[] = [];
    let quotes = 0;
    await page.route("**/*", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><div id="done"></div>' });
      if (path === "/api/commercial/image-analysis") {
        quotes++;
        return route.fulfill({ json: { id: "same-task", credits: 4, expiresAt: new Date(Date.now() + 600000).toISOString() } });
      }
      confirms.push(path);
      return route.fulfill({ status: confirms.length === 1 ? 503 : 200, json: confirms.length === 1 ? { code: "TASK_CONFIRMATION_UNKNOWN" } : { id: "same-task", state: "queued" } });
    });
    await page.goto("https://fixture.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("图片分析 · 1 张 · 4 积分").waitFor();
    expect(confirms).toHaveLength(0);
    await page.getByRole("button", { name: "确认并分析", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("button", { name: "取消", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "确认并分析", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("done")?.textContent === "same-task");
    expect(quotes).toBe(1);
    expect(confirms).toEqual(["/api/commercial/tasks/same-task", "/api/commercial/tasks/same-task"]);
  } finally { await browser.close(); }
}, 30000);
