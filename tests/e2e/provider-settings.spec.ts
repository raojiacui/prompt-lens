import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";

const registration = "https://www.infistar.cc/register?aff=PROMPTLENS&ref_source=link";
const verification = "https://mozhenzhen.com/go/prompt-lens";

test.beforeEach(async ({ context, baseURL }) => {
  const secret = process.env.PROVIDER_UI_TEST_AUTH_SECRET;
  if (!secret) return;
  const hostname = new URL(baseURL!).hostname;
  expect(["localhost", "127.0.0.1"]).toContain(hostname);
  const expiresAt = Date.now() + 3600_000;
  const session = { session: { id: "isolated-provider-ui", userId: "fixture-user", token: "local-fixture", expiresAt: new Date(expiresAt).toISOString() }, user: { id: "fixture-user", name: "Test", email: "raojiacui@gmail.com" }, updatedAt: Date.now(), version: "1" };
  const signature = createHmac("sha256", secret).update(JSON.stringify({ ...session, expiresAt })).digest("base64url");
  await context.addCookies([{ name: "better-auth.session_data", value: Buffer.from(JSON.stringify({ session, expiresAt, signature })).toString("base64url"), domain: hostname, path: "/" }]);
});

for (const width of [1440, 390]) {
  test(`announcement reappears on reload and re-entry at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: new URL(String(test.info().project.use.baseURL || "http://localhost:3000")).hostname, path: "/" }]);
    // Users who dismissed the previous release must also see the announcement again.
    await context.addCookies([{ name: "promptlens-infistar-announcement-v1", value: "closed", domain: new URL(String(test.info().project.use.baseURL || "http://localhost:3000")).hostname, path: "/" }]);
    await page.goto("/");
    const banner = page.getByRole("complementary", { name: "新用户体验额度" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link")).toHaveAttribute("href", registration);
    await expect(banner.locator('img[src*="prompt-lens-icon"]')).toBeVisible();
    await expect(banner.locator('img[src*="infistar-logo"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `tmp/infistar/announcement-${width}.png` });
    await page.getByRole("button", { name: "关闭公告" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(banner).toBeVisible();
    await page.getByRole("button", { name: "关闭公告" }).click();
    await page.goto("/login");
    await page.goto("/");
    await expect(banner).toBeVisible();
  });
}

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`provider settings ${locale} at ${width}px`, async ({ page, context }) => {
    const zh = locale === "zh";
    await page.setViewportSize({ width, height: 1100 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: new URL(String(test.info().project.use.baseURL || "http://localhost:3000")).hostname, path: "/" }]);
    const keys = [{ id: "kie-fixture", provider: "kie", isActive: true, apiKey: "kie-••••1234" }];
    let preferredProvider = "kie";
    let rejectFirstSave = true;
    const requests: Array<{ provider: string; apiKey?: string }> = [];
    await page.route("**/api/**", async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (path === "/api/settings/api-key") {
        if (request.method() === "POST") {
          const body = request.postDataJSON(); requests.push(body);
          if (rejectFirstSave) { rejectFirstSave = false; return route.fulfill({ status: 400, json: { code: "KEY_VALIDATION_FAILED" } }); }
          keys.unshift({ id: "infistar-fixture", provider: body.provider, isActive: true, apiKey: "sk-f••••1234" });
        }
        if (request.method() === "PATCH") preferredProvider = request.postDataJSON().provider;
        return route.fulfill({ json: { apiKeys: keys, preferredProvider, success: true } });
      }
      return route.fulfill({ json: path.includes("/auth/get-session") ? { session: { id: "fixture-session", token: "fixture", expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: "fixture-user", email: "test@example.com", name: "Test" } }
        : path === "/api/credits/me" ? { balance: 0, mode: "byok", hasUserApiKey: true, byokProvider: preferredProvider, commercial: { credits: 0 } } : {} });
    });
    await page.goto("/dashboard?tab=settings");
    await expect(page.getByRole("heading", { name: /^(无限星河 Infistar|KIE)$/ })).toHaveText(["无限星河 Infistar", "KIE"]);
    for (const filename of ["infistar-logo", "kie-logo", "mozhenzhen-logo"]) {
      const logo = page.locator(`img[src*="${filename}"]`);
      await expect(logo).toBeVisible();
      await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    await expect(page.getByText(zh ? "推荐" : "Recommended", { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="${registration}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="${verification}"]`)).toHaveAttribute("target", "_blank");
    await page.getByPlaceholder(zh ? "输入 Infistar API Key" : "Enter your Infistar API key").fill("sk-fake-test-key-not-real-1234");
    await expect(page.getByRole("button", { name: zh ? "测试连接" : "Test connection", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: zh ? "验证失败" : "Verification failed" })).toBeVisible();
    await expect(page.getByPlaceholder(zh ? "输入 Infistar API Key" : "Enter your Infistar API key")).toHaveValue("sk-fake-test-key-not-real-1234");
    await expect(page.getByText("kie-••••1234")).toBeVisible();
    await expect(page.getByText("sk-f••••1234")).toHaveCount(0);
    expect(preferredProvider).toBe("kie");
    await page.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).first().click();
    await expect(page.getByRole("status")).toContainText(zh ? "验证通过，已保存" : "verified and saved");
    await expect(page.getByText("sk-f••••1234")).toBeVisible();
    expect(preferredProvider).toBe("kie");
    await page.getByRole("button", { name: zh ? "设为首选" : "Set as preferred", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(zh ? "首选供应商已更新" : "Preferred provider updated");
    expect(preferredProvider).toBe("infistar");
    expect(requests.every(request => request.provider === "infistar")).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `tmp/infistar/settings-${locale}-${width}.png`, fullPage: true });
  });
}
