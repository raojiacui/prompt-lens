import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`Alipay checkout ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let paid = false;
    let requests = 0;
    const checkout = { orderId: "11111111-1111-4111-8111-111111111111", status: "pending", expiresAt: new Date(Date.now() + 300000).toISOString(), qrImageUrl: "https://example.com/test-qr.svg", mobilePaymentUrl: "https://example.com/test-pay" };
    await page.route("https://example.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224"><rect width="224" height="224" fill="white"/><rect x="8" y="8" width="208" height="208" fill="none" stroke="black" stroke-width="8"/><text x="112" y="112" text-anchor="middle" font-family="sans-serif">TEST ONLY</text></svg>' }));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/payments/checkout") {
        if (route.request().method() === "POST") {
          requests++;
          expect(route.request().postDataJSON()).toMatchObject({ packageId: "v6_trial_200", method: "alipay", provider: "xunhupay" });
          body = checkout;
        } else body = { enabled: true };
      } else if (path.includes("/api/payments/orders/")) body = { ...checkout, status: paid ? "paid" : "pending" };
      await route.fulfill({ json: body });
    });
    await page.goto("/#pricing");
    const pricing = page.locator("#pricing");
    await expect(pricing.locator("article")).toHaveCount(3);
    await page.getByRole("button", { name: locale === "zh" ? "支付宝购买" : "Buy with Alipay" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("¥19.90", { exact: true })).toBeVisible();
    if (width === 390) {
      await expect(dialog.getByRole("link", { name: locale === "zh" ? "前往支付宝支付" : "Continue to Alipay" })).toHaveAttribute("href", checkout.mobilePaymentUrl);
      await expect(dialog.locator("img")).toHaveCount(0);
    } else await expect(dialog.locator("img")).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/checkout-${locale}-${width}.png` });
    paid = true;
    await dialog.getByRole("button", { name: locale === "zh" ? "重新查询" : "Check again" }).click();
    await expect(dialog.getByText(locale === "zh" ? "支付成功，权益已到账" : "Payment received. Credits and rewrites added.", { exact: true })).toBeVisible();
    expect(requests).toBe(1);
    await dialog.getByRole("button", { name: locale === "zh" ? "关闭" : "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await pricing.scrollIntoViewIfNeeded();
    await pricing.screenshot({ path: `test-results/pricing-${locale}-${width}.png` });
  });
}

test("checkout remains unavailable when its readiness endpoint fails", async ({ page }) => {
  await page.route("**/api/payments/checkout", (route) => route.abort());
  await page.goto("/#pricing");
  const buttons = page.locator("#pricing article button");
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) await expect(button).toBeDisabled();
});

test("network retry reuses the request and expiry does not imply failed payment", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", domain: "localhost", path: "/" }]);
  const requestIds: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/auth/get-session")) return route.fulfill({ json: { user: { id: "test", email: "test@example.com" }, session: { id: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
    if (path === "/api/payments/checkout") {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
      requestIds.push(route.request().postDataJSON().requestId);
      if (requestIds.length === 1) return route.fulfill({ status: 502, json: { code: "CHECKOUT_STATUS_UNKNOWN" } });
      return route.fulfill({ json: { orderId: "11111111-1111-4111-8111-111111111111", status: "pending", expiresAt: new Date(Date.now() - 1000).toISOString(), qrImageUrl: "https://example.com/qr.png", mobilePaymentUrl: null } });
    }
    if (path.includes("/api/payments/orders/")) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: {} });
  });
  await page.goto("/#pricing");
  await page.getByRole("button", { name: "Buy with Alipay" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Check again" }).click();
  await expect(dialog.getByText("Payment code expired. If paid, wait for confirmation.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText("Payment status is unavailable. Do not pay again.");
  await expect(dialog.locator("img")).toHaveCount(0);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  const newOrder = dialog.getByRole("button", { name: "Create a new order" });
  await expect(newOrder).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await newOrder.click();
  await expect.poll(() => requestIds.length).toBe(3);
  expect(requestIds[2]).not.toBe(requestIds[1]);
});
