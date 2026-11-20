import { test, expect } from "@playwright/test";

const orderId = "11111111-1111-4111-8111-111111111111";
for (const width of [390, 1440]) for (const currency of ["USD", "JPY"]) test(`Waffo ${currency} checkout preserves retries and confirms server status at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 900 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  let paid = false;
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/auth/get-session")) return route.fulfill({ json: { user: { id: "waffo-test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "fixture", expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
    if (path === "/api/payments/waffo/checkout") {
      const amountMinor = currency === "JPY" ? 750 : 489;
      if (route.request().method() === "GET") {
        const quoteCurrency = new URL(route.request().url()).searchParams.get("currency") || "USD";
        return route.fulfill({ json: { enabled: true, packages: ["v6_trial_200"], suggestedCurrency: "USD", quotes: [{ packageId: "v6_trial_200", currency: quoteCurrency, amountMinor: quoteCurrency === "JPY" ? 750 : 489 }] } });
      }
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { orderId, status: "pending", currency, amountMinor, checkoutUrl: "https://pancake.waffo.ai/fixture#token=fixture" } });
    }
    if (path === `/api/payments/orders/${orderId}`) return route.fulfill({ json: { orderId, status: paid ? "paid" : "pending" } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/pricing");
  await page.getByLabel("计价币种", { exact: true }).selectOption(currency);
  await expect(page.locator("#pricing article").first()).toContainText(currency);
  await page.locator("#pricing").getByRole("button", { name: "购买套餐", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "购买套餐" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "前往 Waffo 安全结账" })).toHaveAttribute("href", "https://pancake.waffo.ai/fixture#token=fixture");
  await expect(dialog).toContainText("最终税费");
  await expect(dialog).toContainText(currency);
  await expect(dialog).toContainText(currency === "JPY" ? "750" : "4.89");
  expect(requests[0].currency).toBe(currency);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await dialog.getByRole("button", { name: "刷新结账与支付状态" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ orderId });
  paid = true;
  await expect(dialog).toContainText("支付成功，套餐权益已到账。", { timeout: 10000 });
  await expect(dialog.getByRole("link", { name: "前往 Waffo 安全结账" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator("#pricing").getByRole("button", { name: "购买套餐", exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].requestId).not.toBe(requests[0].requestId);
});
test("keeps foreign checkout unavailable when exchange rates fail", async ({ page }) => {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/payments/waffo/checkout") {
      if (url.searchParams.has("currency")) return route.fulfill({ status: 503, json: { code: "WAFFO_EXCHANGE_RATE_UNAVAILABLE" } });
      return route.fulfill({ json: { enabled: true, packages: ["v6_trial_200"], suggestedCurrency: "USD" } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/pricing");
  await expect(page.locator("#pricing").getByRole("alert")).toContainText(/换算价格|Converted prices/);
  await expect(page.locator("#pricing article").first().getByRole("button")).toBeDisabled();
});

test("Waffo stays unavailable with an unconfigured environment", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.goto("/pricing");
  await expect(page.locator("#pricing article button")).toHaveCount(3);
  for (const button of await page.locator("#pricing article button").all()) await expect(button).toBeDisabled();
});
