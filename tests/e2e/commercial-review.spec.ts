import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`support sees only refund requests ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    await page.route("**/api/admin/payments/commercial**", async (route) => {
      expect(route.request().method()).toBe("GET");
      expect(new URL(route.request().url()).searchParams.get("view")).toBe("refunds");
      return route.fulfill({ json: { total: 0, page: 1, refunds: [] } });
    });
    await page.goto("/billing/review");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "zh" ? "退款申请" : "Refund requests");
    await expect(page.getByText(locale === "zh" ? "暂无待处理的退款申请" : "No refund requests awaiting review")).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "zh" ? "查询支付状态" : "Query payment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: locale === "zh" ? "核对未交付任务" : "Review undelivered task" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
