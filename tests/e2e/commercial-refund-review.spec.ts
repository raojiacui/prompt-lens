import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) for (const decision of ["approve", "reject"]) {
  test(`support reviews refund ${decision} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    let reviewed = false;
    const actions: Record<string, unknown>[] = [];
    await page.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname !== "/api/admin/payments/commercial") {
        await route.fulfill({ json: {} });
        return;
      }
      if (route.request().method() === "POST") {
        actions.push(route.request().postDataJSON());
        reviewed = true;
        await route.fulfill({ json: { state: decision === "approve" ? "succeeded" : "rejected" } });
      } else await route.fulfill({ json: { orders: [], tasks: [], frozen: [], refunds: reviewed ? [] : [{ id: "11111111-1111-4111-8111-111111111111", orderId: "22222222-2222-4222-8222-222222222222", state: "requested", reason: "Purchased by mistake", contact: "customer-wechat", amountCents: 2190 }] } });
    });
    await page.goto("/billing/review");
    await page.getByRole("button", { name: "审核申请" }).click();
    const approve = page.getByRole("button", { name: "同意并执行退款" });
    const reject = page.getByRole("button", { name: "拒绝申请并恢复额度" });
    await expect(approve).toBeDisabled();
    await expect(reject).toBeDisabled();
    await page.getByLabel("沟通记录与处理依据").fill("Customer contacted and order verified");
    await expect(reject).toBeDisabled();
    await page.getByLabel("已与用户沟通并核对订单").check();
    await expect(reject).toBeEnabled();
    await expect(approve).toBeDisabled();
    if (decision === "approve") await page.getByLabel(/我同意退还此订单全额/).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/refund-review-${decision}-${width}.png`, fullPage: true });
    await (decision === "approve" ? approve : reject).click();
    await expect(page.getByRole("button", { name: "审核申请" })).toHaveCount(0);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: `${decision}_refund`, customerContacted: true, evidence: "Customer contacted and order verified" });
  });
}

test("homepage lists support WeChat and partnership email", async ({ page }) => {
  await page.goto("/");
  const support = page.locator("#support");
  await expect(support.getByText(/13117177652/)).toBeVisible();
  await expect(support.locator('a[href="mailto:489543971@qq.com"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await support.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: "test-results/support-footer-mobile.png", fullPage: false });
});

for (const width of [1440, 390]) for (const state of ["succeeded", "review"]) test(`query existing refund ${state} ${width}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  const id = "11111111-1111-4111-8111-111111111111";
  let queried = false;
  const actions: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/admin/payments/commercial") return route.fulfill({ json: {} });
    if (route.request().method() === "POST") {
      actions.push(route.request().postDataJSON()); queried = true;
      return route.fulfill({ json: { id, state } });
    }
    return route.fulfill({ json: { orders: [], tasks: [], frozen: [], refunds: queried && state === "succeeded" ? [] : [{ id, orderId: id, state: "review", reason: "Unused", contact: "wechat", amountCents: 2190 }] } });
  });
  await page.goto("/billing/review");
  await expect(page.getByRole("button", { name: "审核申请" })).toHaveCount(0);
  await page.getByRole("button", { name: "查询退款状态" }).click();
  await expect(page.getByRole("status")).toContainText(state === "succeeded" ? "支付宝已确认退款成功" : "未再次发起退款");
  expect(actions).toEqual([{ action: "query_refund", refundId: id }]);
  if (state === "succeeded") await expect(page.getByRole("button", { name: "查询退款状态" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `test-results/refund-query-${state}-${width}.png` });
});
