import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`directory loads only the requested page at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    const requests: string[] = [];
    let failNext = false;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      let body: unknown = {};
      if (url.pathname.includes("/auth/get-session")) body = { session: { id: "session", token: "test", expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: "owner", email: "raojiacui@gmail.com", name: "Owner", role: "user" } };
      else if (url.pathname === "/api/admin/me") body = { isAdmin: true };
      else if (url.pathname === "/api/admin/overview") {
        expect(url.searchParams.get("summary")).toBe("1");
        body = { overview: { totalUsers: 45, purchasedUsers: 17 }, daily: [], dataHealth: { degraded: false, unavailable: [] } };
      } else if (url.pathname.endsWith("/credits")) {
        body = { entries: [{ id: "test-order", kind: "order", reference: "test-order", createdAt: "2026-10-03T00:00:00Z", status: "paid", packageName: "体验包", amountCents: 2190, currency: "cny", credits: 200 }], total: 1, page: 1, limit: 20 };
      } else if (url.pathname === "/api/admin/users") {
        requests.push(url.search);
        if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { error: "unavailable" } }); return; }
        const view = url.searchParams.get("view")!;
        const current = Number(url.searchParams.get("page"));
        const limit = Number(url.searchParams.get("limit"));
        const q = url.searchParams.get("q");
        const total = q === "none" ? 0 : q ? 1 : 45;
        body = { users: Array.from({ length: Math.max(0, Math.min(limit, total - (current - 1) * limit)) }, (_, i) => ({ id: `${view}-${(current - 1) * limit + i}`, name: `User ${(current - 1) * limit + i}`, email: `${view}-${(current - 1) * limit + i}@example.com`, role: "user", banned: false })), total, page: current, limit, view, dataHealth: { degraded: false, unavailable: [] } };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=admin");
    const directory = page.getByRole("region", { name: "用户明细" });
    await expect(directory.getByText("all-0@example.com")).toBeVisible();
    expect(requests).toHaveLength(1);
    await expect(page.getByRole("link", { name: "退款申请与资金对账" })).toHaveAttribute("href", "/billing/review#refunds");
    await page.getByRole("button", { name: /已购买套餐/ }).click();
    const purchases = page.getByRole("dialog", { name: "已到账套餐用户" });
    await expect(purchases.getByText("paid-0@example.com")).toBeVisible();
    await purchases.getByRole("button", { name: "订单与流水" }).first().click();
    const records = page.getByRole("dialog", { name: "订单与积分流水" });
    await expect(records.getByText("test-order", { exact: true })).toBeVisible();
    await expect(records.getByText("200", { exact: true })).toBeVisible();
    await records.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(records).toHaveCount(0);
    await purchases.getByRole("button", { name: "关闭", exact: true }).click();
    expect(requests).toHaveLength(2);
    await directory.getByRole("button", { name: "下一页" }).click();
    await expect(directory.getByText("all-20@example.com")).toBeVisible();
    await expect(directory.getByText("all-0@example.com")).toHaveCount(0);
    expect(requests).toHaveLength(3);
    await directory.getByRole("button", { name: "下一页" }).click();
    await expect(directory.getByText("all-44@example.com")).toBeVisible();
    await expect(directory.getByRole("button", { name: "下一页" })).toBeDisabled();
    await directory.getByRole("button", { name: "上一页" }).click();
    await expect(directory.getByText("all-20@example.com")).toBeVisible();
    await directory.getByRole("tab", { name: "付费用户" }).click();
    await expect(directory.getByText("paid-0@example.com")).toBeVisible();
    expect(requests.at(-1)).toContain("view=paid&page=1");
    await directory.getByRole("tab", { name: "使用排行" }).click();
    await expect(directory.getByText("usage-0@example.com")).toBeVisible();
    await directory.getByRole("textbox", { name: "搜索姓名或邮箱" }).fill("none");
    const beforeSearch = requests.length;
    expect(requests).toHaveLength(beforeSearch);
    await directory.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(directory.getByText("暂无匹配用户")).toBeVisible();
    expect(requests.at(-1)).toContain("q=none");
    await directory.getByRole("textbox").fill("");
    await directory.getByRole("textbox").press("Enter");
    await expect(directory.getByText("usage-0@example.com")).toBeVisible();
    failNext = true;
    await directory.getByRole("button", { name: "下一页" }).click();
    await expect(directory.getByRole("alert")).toBeVisible();
    await directory.getByRole("button", { name: "重试" }).click();
    await expect(directory.getByText("usage-20@example.com")).toBeVisible();
    await directory.getByRole("combobox", { name: "每页条数" }).selectOption("50");
    await expect(directory.getByText("usage-44@example.com")).toBeVisible();
    expect(requests.at(-1)).toContain("page=1&limit=50");
    const dimensions = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(dimensions.actual).toBeLessThanOrEqual(dimensions.viewport);
    await directory.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/admin-directory-${width}.png` });
  });
}
