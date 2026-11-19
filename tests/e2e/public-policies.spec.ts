import { expect, test } from "@playwright/test";

const policies = [
  { path: "/terms", zh: "服务条款", en: "Terms of Service" },
  { path: "/privacy", zh: "隐私政策", en: "Privacy Policy" },
  { path: "/refund", zh: "退款与取消政策", en: "Refund & Cancellation Policy" },
];

for (const locale of ["zh", "en"] as const) {
  for (const width of [390, 1440]) {
    test(`public policy navigation, content and metadata ${locale} ${width}px`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
      // No real account, payment or analytics writes during this public-page check.
      await page.route("**/api/**", route => route.fulfill({ json: { user: null, session: null } }));
      await page.route("https://fonts.googleapis.com/**", route => route.abort());
      await page.route("https://fonts.gstatic.com/**", route => route.abort());
      for (const policy of policies) {
        const response = await page.goto(policy.path);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(policy[locale]);
        await expect(page).toHaveTitle(`${policy[locale]} | Prompt Lens`);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${policy.path}$`));
        const navigation = page.getByRole("navigation", { name: locale === "zh" ? "条款与政策导航" : "Policy navigation" });
        await expect(navigation.getByRole("link", { name: policy[locale], exact: true })).toHaveAttribute("aria-current", "page");
        for (const link of policies) {
          await expect(page.locator("footer").getByRole("link", { name: link[locale], exact: true })).toHaveAttribute("href", link.path);
        }
        await expect(page.locator("main a[href='mailto:489543971@qq.com']")).toBeVisible();
        await expect(page.locator("main article section")).not.toHaveCount(0);
        if (policy.path === "/terms") {
          const aup = page.locator("main article section#safety");
          await expect(aup).toContainText(locale === "zh" ? "3 个工作日内完成初步核查" : "within 3 business days");
          await expect(aup).toContainText(locale === "zh" ? "举报和申诉均适用此时限" : "both reports and appeals");
          await expect(aup).toContainText(locale === "zh" ? "预计完成时间" : "estimated completion time");
          await expect(aup).toContainText("Waffo Prompt Sift");
          await expect(aup).toContainText("Google Cloud Video Intelligence");
          await expect(aup).not.toContainText(locale === "zh" ? "尚未上线的独立自动" : "screening not yet released");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.getByRole("navigation", { name: locale === "zh" ? "条款与政策导航" : "Policy navigation" }).getByRole("link", { name: policies[1][locale], exact: true }).click();
      await expect(page).toHaveURL(/\/privacy$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(policies[1][locale]);
      await page.screenshot({ path: testInfo.outputPath("privacy.png"), fullPage: false });
    });
  }
}
