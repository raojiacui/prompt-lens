import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) for (const outcome of ["cancelled", "paid", "pending", "unknown"]) {
  test(`cancel checkout ${outcome} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    let state = "pending";
    let closes = 0;
    const checkout = { orderId: "11111111-1111-4111-8111-111111111111", amountCents: 2190, credits: 200, rewrites: 20, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), paymentUrl: "/api/payments/orders/11111111-1111-4111-8111-111111111111/pay" };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes("/auth/get-session")) return route.fulfill({ json: { user: { id: "test", email: "test@example.com" }, session: { id: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
      if (path === "/api/payments/checkout") return route.fulfill({ json: route.request().method() === "GET" ? { enabled: true } : { ...checkout, status: state } });
      if (path.endsWith("/close")) {
        expect(route.request().method()).toBe("POST");
        closes++;
        if (outcome === "unknown") return route.fulfill({ status: 502, json: { code: "CLOSE_STATUS_UNKNOWN" } });
        state = outcome;
        return route.fulfill({ status: outcome === "pending" ? 202 : 200, json: { status: state, cancellationRequested: true } });
      }
      if (path.includes("/api/payments/orders/")) return route.fulfill({ json: { ...checkout, status: state, cancellationRequested: closes > 0, paymentUrl: closes ? null : checkout.paymentUrl } });
      await route.fulfill({ json: {} });
    });
    await page.goto("/#pricing");
    await page.getByRole("button", { name: "支付宝购买" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: "前往支付宝支付" })).toBeVisible();
    await dialog.getByRole("button", { name: "取消本次付款" }).click();
    if (outcome === "unknown") {
      await expect(dialog.getByRole("alert")).toContainText("取消请求未能保存");
      await expect(dialog.getByRole("link", { name: "前往支付宝支付" })).toHaveCount(0);
      const bounds = await dialog.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    } else await expect(dialog).toHaveCount(0);
    expect(closes).toBe(1);
    await page.screenshot({ path: `test-results/cancel-${outcome}-${width}.png` });
  });
}

test("the order list does not offer payment cancellation", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const id = "11111111-1111-4111-8111-111111111111";
  let cancelled = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/close")) { cancelled = true; return route.fulfill({ json: { status: "cancelled" } }); }
    await route.fulfill({ json: { wallet: { credits: 0, rewrites: 0, heldCredits: 0, heldRewrites: 0 }, orders: [{ id, packageId: "v6_trial_200", packageName: "Starter", amountCents: 2190, status: cancelled ? "cancelled" : "pending", createdAt: new Date().toISOString() }], refunds: [], tasks: [] } });
  });
  await page.goto("/billing");
  await expect(page.getByRole("button", { name: "取消本次付款" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看订单" })).toBeVisible();
  expect(cancelled).toBe(false);
});
