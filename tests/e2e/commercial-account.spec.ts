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
      if (path === "/api/auth/get-session") return route.fulfill({ json: { user: { id: "customer", name: "Customer", email: "customer@example.com" }, session: { id: "session", userId: "customer", expiresAt: "2099-01-01T00:00:00.000Z" } } });
      if (path === "/api/payments/account") body = {
        wallet: { credits: requested ? 0 : 200, rewrites: requested ? 0 : 20, heldCredits: 0, heldRewrites: 0, frozen: false },
        orders: [{ id, packageId: "v6_trial_200", packageName: "Starter", amountCents: 1990, status: "paid", createdAt: new Date().toISOString() }],
        refunds: requested ? [{ id: "refund", orderId: id, state: "requested" }] : [], tasks: [],
      };
      else if (path.endsWith("/refund")) {
        expect(route.request().postDataJSON()).toEqual({ reason: "Purchased by mistake", contact: "customer-wechat" });
        requested = true; body = { id: "refund", state: "requested" };
      }
      else if (path === "/api/payments/checkout" && route.request().method() === "POST") checkoutPosts++;
      await route.fulfill({ json: body });
    });
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: locale === "zh" ? "余额与订单" : "Balance and orders" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: locale === "zh" ? "申请退款" : "Request refund", exact: true })).toHaveCount(0);
    await page.goto("/billing#refund-request");
    await page.locator("#refund-request select").selectOption(id);
    expect(requested).toBe(false);
    const form = page.getByRole("form", { name: locale === "zh" ? "退款申请表单" : "Refund request form" });
    const submit = page.getByRole("button", { name: locale === "zh" ? "提交申请，等待客服审核" : "Submit for support review" });
    await expect(submit).toBeDisabled();
    await form.locator("textarea").fill("Purchased by mistake");
    await form.locator("input").fill("customer-wechat");
    await page.screenshot({ path: `test-results/refund-form-${locale}-${width}.png`, fullPage: true });
    await submit.click();
    await expect(page.getByText(locale === "zh" ? "等待客服审核" : "Awaiting support review", { exact: true })).toBeVisible();
    await expect(page.getByText(/13117177652/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "zh" ? "查看工单" : "View ticket", exact: true })).toBeVisible();
    expect(checkoutPosts).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/billing-${locale}-${width}.png`, fullPage: true });
  });
}

for (const width of [1440, 390]) test(`historical checkout uses order snapshot ${width}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const id = "11111111-1111-4111-8111-111111111111";
  let posts = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/payments/") && route.request().method() === "POST") posts++;
    if (path === "/api/payments/account") return route.fulfill({ json: {
      wallet: { credits: 0, rewrites: 0, heldCredits: 0, heldRewrites: 0 },
      orders: [{ id, packageId: "v6_trial_200", packageName: "Starter", amountCents: 1990, status: "pending", createdAt: new Date().toISOString() }], refunds: [], tasks: [],
    } });
    if (path === `/api/payments/orders/${id}`) return route.fulfill({ json: {
      orderId: id, amountCents: 1990, credits: 180, rewrites: 12, status: "pending", expiresAt: new Date(Date.now() + 600000).toISOString(), paymentUrl: `/api/payments/orders/${id}/pay`,
    } });
    await route.fulfill({ json: {} });
  });
  await page.goto("/billing");
  await page.getByRole("button", { name: "查看订单" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("¥19.90", { exact: true })).toBeVisible();
  await expect(dialog.getByText("180 积分 · 12 次改写", { exact: true })).toBeVisible();
  await expect(dialog.getByText("¥21.90", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "前往支付宝支付" })).toHaveAttribute("href", `/api/payments/orders/${id}/pay`);
  expect(posts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `test-results/historical-checkout-${width}.png` });
});
