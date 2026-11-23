import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
it("allows custom benefits and retries an ambiguous grant with the same immutable request", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AdminEntitlementGrants} from './components/admin-entitlement-grants';createRoot(document.getElementById('root')).render(<AdminEntitlementGrants/>);`, resolveDir: process.cwd(), loader: "tsx" }, alias: { "@": process.cwd() }, bundle: true, write: false, platform: "browser", jsx: "automatic" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => console.error("gift-ui", error.message));
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/*", route => {
      const request = route.request();
      if (new URL(request.url()).pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (request.method() === "GET") return route.fulfill({ json: { packages: [{ id: "v6_trial_200", name: "体验包", credits: 200, rewrites: 20, linkImports: 12 }], records: [] } });
      bodies.push(request.postDataJSON());
      return route.fulfill({ status: bodies.length === 1 ? 503 : 200, json: bodies.length === 1 ? { error: "结果暂未确认" } : { email: "friend@example.com", created: false, expiresAt: new Date(Date.now()+86400000).toISOString() } });
    });
    await page.goto("https://fixture.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByLabel("用户邮箱").fill("friend@example.com");
    await page.getByLabel("发放权益").selectOption("custom");
    await page.getByLabel("通用积分", { exact: true }).fill("42");
    await page.getByLabel("有效期").selectOption("1");
    await page.getByRole("button", { name: "发放权益", exact: true }).click();
    await page.getByRole("button", { name: "重试同一笔发放" }).waitFor();
    expect(await page.getByLabel("用户邮箱").isDisabled()).toBe(true);
    await page.getByRole("button", { name: "重试同一笔发放" }).click();
    await page.getByRole("status").waitFor();
    expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({ email: "friend@example.com", packageId: "custom", credits: 42, days: 1 });
    expect(await page.getByLabel("用户邮箱").inputValue()).toBe("");
  } finally { await browser.close(); }
}, 30000);
