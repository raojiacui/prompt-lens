import { test, expect } from "@playwright/test";
for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`audited review requires evidence ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    const actions: Record<string, string>[] = [];
    await page.route("**/api/admin/payments/commercial", async (route) => {
      if (route.request().method() === "POST") { actions.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { orders: [], refunds: [], tasks: actions.length ? [] : [{ id: "11111111-1111-4111-8111-111111111111", userId: "owner", credits: 95, rewrites: 0 }], frozen: [] } });
    });
    await page.goto("/billing/review");
    await page.getByRole("button", { name: locale === "zh" ? "核对未交付任务" : "Review undelivered task" }).click();
    const release = page.getByRole("button", { name: locale === "zh" ? "确认未交付并释放预留" : "Confirm non-delivery and release" });
    await expect(release).toBeDisabled(); expect(actions).toHaveLength(0);
    await page.getByRole("textbox").fill("Provider receipt checked: task was not delivered or billed.");
    await expect(release).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/review-${locale}-${width}.png` });
    await release.click();
    await expect.poll(() => actions.length).toBe(1);
    expect(actions[0]).toMatchObject({ action: "release_unfulfilled_task", evidence: "Provider receipt checked: task was not delivered or billed." });
  });
}
