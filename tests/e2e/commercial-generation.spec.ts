import { test, expect } from "@playwright/test";
for (const locale of ["zh", "en"]) for (const width of [1440, 390]) for (const finalPayer of ["platform", "byok"]) {
  test(`generation with one click and no cost dialog ${locale} ${width} ${finalPayer}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let quotes = 0;
    let confirmed: string[] = [];
    let legacySubmissions = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/commercial/config") body = { commercialConsumptionEnabled: true };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, commercial: { credits: 650, rewrites: 60 } };
      else if (path === "/api/models") body = { models: [] };
      else if (path === "/api/commercial/generation") { quotes++; body = { id: `quote-${quotes}`, credits: 95, model: "wan/2-6-text-to-video", duration: 5, resolution: "720p" }; }
      else if (path === "/api/commercial/confirm") { confirmed = route.request().postDataJSON().ids; body = { tasks: confirmed.map((id) => ({ id, state: "queued" })) }; }
      else if (path.startsWith("/api/commercial/tasks/")) body = { state: "running" };
      else if (path === "/api/generation-jobs" && route.request().method() === "POST") {
        legacySubmissions++;
        expect(route.request().postDataJSON().payer).toBe("byok");
        body = { providerTaskId: `byok-${legacySubmissions}` };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator('#features a[href="/dashboard?tab=video-gen"]')).toHaveCount(1);
    await page.goto("/dashboard?tab=video-gen&duration=5&videoGenPrompt=A%20cinematic%20cloud%20palace", { waitUntil: "domcontentloaded" });
    await page.getByLabel(locale === "zh" ? "费用来源" : "Payment source").selectOption("platform");
    await page.getByRole("button", { name: /720p.*5(?:s| 秒)|5s.*720p/i }).click();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.getByLabel(locale === "zh" ? "费用来源" : "Payment source").selectOption(finalPayer);
    await expect(page.getByRole("button", { name: locale === "zh" ? /^生成视频/ : /^Generate Video/i })).toContainText(locale === "zh" ? "积分" : "credits");
    await page.getByRole("button", { name: locale === "zh" ? /^生成视频/ : /^Generate Video/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => finalPayer === "platform" ? confirmed.length : legacySubmissions).toBe(2);
    if (finalPayer === "platform") {
      expect(quotes).toBe(2); expect(confirmed).toEqual(["quote-1", "quote-2"]); expect(legacySubmissions).toBe(0);
    } else {
      expect(quotes).toBe(0); expect(confirmed).toHaveLength(0); expect(legacySubmissions).toBe(2);
    }
  });
}

test("checks a lost submission after reload without opening a dialog or creating another quote", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  let quotes = 0;
  const confirmations: string[][] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
    else if (path === "/api/commercial/config") body = { commercialConsumptionEnabled: true };
    else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, commercial: { credits: 650, rewrites: 60 } };
    else if (path === "/api/commercial/generation") { quotes++; body = { id: "original-quote", credits: 20 }; }
    else if (path === "/api/commercial/confirm") {
      confirmations.push(route.request().postDataJSON().ids);
      if (confirmations.length === 1) { await route.abort("failed"); return; }
      body = { tasks: [{ id: "original-quote", state: "queued" }] };
    } else if (path.startsWith("/api/commercial/tasks/")) body = { state: "running" };
    await route.fulfill({ json: body });
  });
  await page.goto("/dashboard?tab=video-gen&duration=5&videoGenPrompt=A%20cinematic%20cloud%20palace", { waitUntil: "domcontentloaded" });
  await page.getByLabel("费用来源").selectOption("platform");
  await page.getByRole("button", { name: /^生成视频/ }).click();
  await expect(page.getByRole("button", { name: "核对提交", exact: true })).toBeEnabled();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "核对提交", exact: true }).click();
  await expect.poll(() => confirmations.length).toBe(2);
  expect(quotes).toBe(1);
  expect(confirmations).toEqual([["original-quote"], ["original-quote"]]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const payerChoice of ["platform", "byok"] as const) test(`allows ${payerChoice} generation when loading the balance fails`, async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  let byokSubmissions = 0;
  let platformSubmissions = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
    else if (path === "/api/commercial/config") body = { commercialConsumptionEnabled: true };
    else if (path === "/api/credits/me") { await route.fulfill({ status: 500, json: { error: "Database temporarily unavailable" } }); return; }
    else if (path === "/api/commercial/generation") body = { id: "quoted-task", credits: 20 };
    else if (path === "/api/commercial/confirm") {
      platformSubmissions++;
      expect(route.request().postDataJSON().ids).toEqual(["quoted-task"]);
      body = { tasks: [{ id: "quoted-task", state: "queued" }] };
    }
    else if (path === "/api/generation-jobs" && route.request().method() === "POST") {
      byokSubmissions++;
      expect(route.request().postDataJSON().payer).toBe("byok");
      body = { providerTaskId: "own-key-task" };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/dashboard?tab=video-gen&duration=5&videoGenPrompt=A%20cinematic%20cloud%20palace", { waitUntil: "domcontentloaded" });
  const payer = page.getByLabel("费用来源");
  await expect(payer).toBeVisible();
  await expect(payer.locator("option")).toHaveText(["平台积分", "自带 Key"]);
  await expect(payer).toHaveValue("platform");
  await expect(page.getByRole("button", { name: /^生成视频/ })).toContainText("预计");
  await expect(page.getByRole("button", { name: /^生成视频/ })).toBeEnabled();
  await payer.selectOption(payerChoice);
  if (payerChoice === "byok") await expect(page.getByRole("button", { name: /^生成视频/ })).toContainText("0 平台积分");
  await page.getByRole("button", { name: /^生成视频/ }).click();
  await expect.poll(() => payerChoice === "platform" ? platformSubmissions : byokSubmissions).toBe(1);
  expect(payerChoice === "platform" ? byokSubmissions : platformSubmissions).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
