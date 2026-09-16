import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const overview = {
  overview: {
    totalUsers: 925,
    newUsersToday: 4,
    newUsers7d: 31,
    newUsers30d: 126,
    visitorToday: 88,
    visitor7d: 416,
    visitor30d: 810,
    signedInToday: 24,
    signedIn7d: 130,
    signedIn30d: 302,
    activeToday: 88,
    active7d: 416,
    active30d: 810,
    purchasedUsers: 17,
    nonPurchasedUsers: 908,
    totalProjects: 210,
    totalGenerations: 56,
    totalWorkflowJobs: 190,
    uploadCount: 42,
    uploadBytes: 8_100_000,
    analysisCount: 73,
    generationCount: 28,
    videoClips: 91,
  },
  daily: [
    { date: "2026-09-15", activeUsers: 72, signedInUsers: 18, uploads: 9, uploadBytes: 1_200_000, analyses: 12, generations: 5 },
    { date: "2026-09-16", activeUsers: 88, signedInUsers: 24, uploads: 14, uploadBytes: 2_400_000, analyses: 19, generations: 8 },
  ],
  actionCounts: [{ action: "video.analysis", value: 73 }],
  topUsers: [],
  purchasedUsers: [{ userId: "paid-1", email: "buyer@example.com", name: "Buyer", orderCount: 2, totalPaidCents: 3980, lastPaidAt: "2026-09-16T08:00:00.000Z", latestPackageId: "creator", latestPackageName: "创作者版" }],
  recentUsers: [{ id: "new-1", name: "New User", email: "new@example.com", role: "user", createdAt: "2026-09-16T09:00:00.000Z" }],
  dataHealth: { degraded: false, unavailable: [] },
};

for (const scenario of [{ locale: "zh", width: 1440 }, { locale: "en", width: 390 }]) {
  test(`admin overview ${scenario.locale} ${scenario.width}`, async ({ page, context }) => {
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: scenario.locale, domain: "localhost", path: "/" }]);
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) {
        body = { session: { id: "admin-session", token: "test", expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: "admin", email: "admin@example.com", name: "Admin", role: "admin" } };
      } else if (path === "/api/admin/me") {
        body = { isAdmin: true };
      } else if (path === "/api/admin/overview") {
        body = overview;
      } else if (path === "/api/credits/me") {
        body = { balance: 0, trial: { isAdmin: true } };
      }
      await route.fulfill({ json: body });
    });

    await page.goto("/dashboard?tab=admin");
    await expect(page.getByText("buyer@example.com")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(scenario.locale === "zh" ? "访客 DAU" : "Visitor DAU")).toBeVisible();
    await expect(page.getByText(scenario.locale === "zh" ? "登录用户 DAU" : "Signed-in DAU")).toBeVisible();
    await expect(page.getByText(scenario.locale === "zh" ? "后台发放积分" : "Manual credit grant")).toHaveCount(0);
    await expect(page.getByText(scenario.locale === "zh" ? "待确认付款" : "Pending manual payments")).toHaveCount(0);

    const pageWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
    await page.screenshot({ path: `test-results/admin-overview-${scenario.locale}-${scenario.width}.png`, fullPage: true });
  });
}
