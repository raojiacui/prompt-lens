import { test, expect } from "@playwright/test";

test("signed-in purchases do not wait for a launch readiness request", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  let readinessRequests = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/auth/get-session")) return route.fulfill({ json: { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
    if (path === "/api/payments/checkout" && route.request().method() === "GET") {
      readinessRequests++;
      return route.fulfill({ json: { enabled: false } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/#pricing");
  const pricing = page.locator("#pricing");
  await expect(pricing.getByRole("button", { name: "支付宝购买", exact: true }).first()).toBeEnabled();
  await expect(pricing).not.toContainText("支付暂不可用");
  expect(readinessRequests).toBe(0);
});

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`Alipay checkout ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let paid = false;
    let requests = 0;
    const requestIds: string[] = [];
    const checkout = { orderId: "11111111-1111-4111-8111-111111111111", amountCents: 2190, credits: 200, rewrites: 20, status: "pending", expiresAt: new Date(Date.now() + 300000).toISOString(), qrImageUrl: null, paymentUrl: "/api/payments/orders/11111111-1111-4111-8111-111111111111/pay", mobilePaymentUrl: "/api/payments/orders/11111111-1111-4111-8111-111111111111/pay" };
    await page.route("https://example.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224"><rect width="224" height="224" fill="white"/><rect x="8" y="8" width="208" height="208" fill="none" stroke="black" stroke-width="8"/><text x="112" y="112" text-anchor="middle" font-family="sans-serif">TEST ONLY</text></svg>' }));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/payments/checkout") {
        if (route.request().method() === "POST") {
          requests++;
          requestIds.push(route.request().postDataJSON().requestId);
          expect(route.request().postDataJSON()).toMatchObject({ packageId: "v6_trial_200", method: "alipay", provider: "alipay" });
          body = checkout;
        } else body = { enabled: true };
      } else if (path.endsWith("/pay")) return route.fulfill({ contentType: "text/html", body: "<p>Test QR placeholder</p>" });
      else if (path.includes("/api/payments/orders/")) {
        if (paid) await new Promise((resolve) => setTimeout(resolve, 600));
        body = { ...checkout, status: paid ? "paid" : "pending", paymentUrl: paid ? null : checkout.paymentUrl };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/#pricing");
    const pricing = page.locator("#pricing");
    await expect(pricing.locator("article")).toHaveCount(3);
    await expect(pricing).toContainText(locale === "zh" ? "失败不计次" : "failures do not count");
    await expect(pricing).not.toContainText(locale === "zh" ? "失败尝试也占一次" : "Failed attempts also count");
    for (const [index, price] of ["¥21.90", "¥63.90", "¥139"].entries()) {
      await expect(pricing.locator("article").nth(index).getByText(price, { exact: true })).toBeVisible();
      await expect(pricing.locator("article").nth(index)).toContainText(String([12, 30, 61][index]));
    }
    await page.getByRole("button", { name: locale === "zh" ? "支付宝购买" : "Buy with Alipay" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("¥21.90", { exact: true })).toBeVisible();
    await expect(dialog.locator("iframe")).toHaveAttribute("src", `${checkout.paymentUrl}?embedded=1`);
    await expect(dialog.locator("img")).toHaveCount(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/checkout-${locale}-${width}.png` });
    paid = true;
    await dialog.getByRole("button", { name: locale === "zh" ? "我已付款，查询到账" : "I have paid, check payment" }).click();
    const checking = dialog.getByRole("button", { name: locale === "zh" ? "正在查询到账…" : "Checking payment…" });
    await expect(checking).toBeDisabled();
    await expect(checking).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByText(locale === "zh" ? "支付成功，积分已到账" : "Payment successful. Credits added.", { exact: true })).toBeVisible();
    await expect(dialog.locator("iframe")).toHaveCount(0);
    await expect(dialog).not.toContainText(locale === "zh" ? "付款码有效时间" : "Payment code expires in");
    await expect(dialog.getByRole("link", { name: locale === "zh" ? "查看余额与订单" : "Balance and orders" })).toHaveAttribute("href", "/billing");
    expect(requests).toBe(1);
    await dialog.getByRole("button", { name: locale === "zh" ? "完成" : "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    paid = false;
    await page.getByRole("button", { name: locale === "zh" ? "支付宝购买" : "Buy with Alipay" }).first().click();
    await expect(dialog.locator("iframe")).toBeVisible();
    expect(requests).toBe(2);
    expect(requestIds[1]).not.toBe(requestIds[0]);
    await dialog.getByRole("button", { name: locale === "zh" ? "关闭" : "Close", exact: true }).click();
    await pricing.scrollIntoViewIfNeeded();
    await pricing.screenshot({ path: `test-results/pricing-${locale}-${width}.png` });
  });
}

test("actual order failures are reported inside the checkout dialog", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", domain: "localhost", path: "/" }]);
  await page.route("**/api/auth/get-session**", route => route.fulfill({ json: { user: { id: "test", email: "test@example.com" }, session: { id: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } } }));
  await page.route("**/api/payments/checkout", route => route.fulfill({ status: 502, json: { code: "CHECKOUT_STATUS_UNKNOWN" } }));
  await page.goto("/#pricing");
  await page.locator("#pricing").getByRole("button", { name: "Buy with Alipay" }).first().click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Unable to confirm the order. Retry to check.");
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
      return route.fulfill({ json: { orderId: "11111111-1111-4111-8111-111111111111", amountCents: 2190, credits: 200, rewrites: 20, status: "pending", expiresAt: new Date(Date.now() - 1000).toISOString(), qrImageUrl: "https://example.com/qr.png", mobilePaymentUrl: null } });
    }
    if (path.includes("/api/payments/orders/")) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: {} });
  });
  await page.goto("/#pricing");
  await page.getByRole("button", { name: "Buy with Alipay" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "I have paid, check payment" }).click();
  await expect(dialog.getByText("Payment code expired. If paid, wait for confirmation.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText("Payment status is unavailable. Do not pay again.");
  await expect(dialog.locator("img")).toHaveCount(0);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  await expect(dialog.getByRole("button", { name: "Purchase again with a new order" })).toHaveCount(0);
  // An expired order whose provider state is unknown must not solicit a second payment.
  expect(requestIds).toHaveLength(2);
});
