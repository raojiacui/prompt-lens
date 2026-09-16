import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`billing recovery and refund ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let requested = false;
    let checkoutPosts = 0;
    const id = "11111111-1111-4111-8111-111111111111";
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path === "/api/payments/account") body = {
        wallet: { credits: requested ? 0 : 200, rewrites: requested ? 0 : 20, heldCredits: 0, heldRewrites: 0, frozen: false },
        orders: [{ id, packageId: "v6_trial_200", packageName: "Starter", amountCents: 1990, status: "paid", createdAt: new Date().toISOString() }],
        refunds: requested ? [{ id: "refund", orderId: id, state: "processing" }] : [], tasks: [],
      };
      else if (path.endsWith("/refund")) { requested = true; body = { id: "refund", state: "processing" }; }
      else if (path === "/api/payments/checkout" && route.request().method() === "POST") checkoutPosts++;
      await route.fulfill({ json: body });
    });
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: locale === "zh" ? "余额与订单" : "Balance and orders" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: locale === "zh" ? "申请退款" : "Request refund" }).click();
    expect(requested).toBe(false);
    await page.getByRole("button", { name: locale === "zh" ? "确认申请" : "Confirm request" }).click();
    await expect(page.getByText(locale === "zh" ? "退款处理中" : "processing", { exact: true })).toBeVisible();
    expect(checkoutPosts).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/billing-${locale}-${width}.png`, fullPage: true });
  });
}
