import { test, expect } from "@playwright/test";

for (const automatic of [false, true]) test(`old stuck task can stop and resume without resubmission (automatic=${automatic})`, async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  let polls = 0;
  let submissions = 0;
  let failed = false;
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded-stuck-task")) return;
    sessionStorage.setItem("seeded-stuck-task", "yes");
    localStorage.setItem("reference-generation-prompt-lens-video-gen", JSON.stringify([
      { id: "old", label: "Variation 1", status: "generating", progress: 28, providerTaskId: "old-task", notes: "Waiting" },
    ]));
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: "2099-01-01T00:00:00Z" } };
    else if (path === "/api/commercial/config") body = { commercialConsumptionEnabled: true };
    else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, commercial: { credits: 650 } };
    else if (path === "/api/generation-history") body = { history: [] };
    else if (path === "/api/generation-jobs") {
      if (route.request().method() === "POST") submissions++;
      else polls++;
      await route.fulfill(failed ? { json: { providerTaskId: "old-task", status: "fail" } } : { status: 502, json: { error: "Status unavailable" } });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/dashboard?tab=video-gen&videoGenPrompt=A%20cat", { waitUntil: "domcontentloaded" });
  if (automatic) await expect(page.getByRole("button", { name: "恢复查询" })).toBeVisible({ timeout: 20000 });
  else await page.getByRole("button", { name: "停止跟踪" }).click();
  const progress = page.getByTestId("generation-task-progress");
  await expect(progress.getByRole("status")).toHaveText("已停止跟踪，结果待核实");
  await expect(progress.locator(".animate-spin")).toHaveCount(0);
  if (automatic) expect(polls).toBe(3);
  const stoppedPolls = polls;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "恢复查询" })).toBeVisible();
  await page.waitForTimeout(4000);
  expect(polls).toBe(stoppedPolls);
  await page.getByLabel("费用来源").selectOption("byok");
  await expect(page.getByRole("button", { name: /^生成视频/ })).toBeEnabled();
  failed = true;
  await page.getByRole("button", { name: "恢复查询" }).click();
  await expect(progress.getByRole("status")).toHaveText("生成未完成", { timeout: 10000 });
  await expect(progress.locator('[aria-current="step"]')).toContainText("失败");
  const finalPolls = polls;
  await page.waitForTimeout(4000);
  expect(polls).toBe(finalPolls);
  expect(submissions).toBe(0);
});

for (const width of [1440, 390]) for (const locale of ["zh", "en"]) {
  test(`shows real submission stages, sync recovery and completion ${locale} ${width}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    let polling: "working" | "offline" | "complete" = "working";
    let submissions = 0;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      let body: unknown = {};
      if (url.pathname.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: "2099-01-01T00:00:00Z" } };
      else if (url.pathname === "/api/commercial/config") body = { commercialConsumptionEnabled: true };
      else if (url.pathname === "/api/credits/me") body = { commercialConsumptionEnabled: true, commercial: { credits: 650 } };
      else if (url.pathname === "/api/generation-history") body = { history: [], hasMore: false, retentionDays: 7 };
      else if (url.pathname === "/api/generation-jobs" && route.request().method() === "POST") {
        submissions++;
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "stage", stage: "preparing" }, { type: "stage", stage: "submitting" },
          { type: "result", status: 200, body: { providerTaskId: "one" } },
        ].map(item => JSON.stringify(item)).join("\n") + "\n" });
        return;
      } else if (url.pathname === "/api/generation-jobs") {
        if (polling === "offline") { await route.fulfill({ status: 503, json: { error: "Temporary sync error" } }); return; }
        body = { status: polling === "complete" ? "success" : "generating", providerTaskId: "one", ...(polling === "complete" ? { videoUrl: "https://media.example.test/video.mp4" } : {}) };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=video-gen&duration=5&videoGenPrompt=A%20cat%20in%20sunlight", { waitUntil: "domcontentloaded" });
    await page.getByLabel(locale === "zh" ? "费用来源" : "Payment source").selectOption("byok");
    await page.getByRole("button", { name: locale === "zh" ? /^生成视频/ : /^Generate Video/i }).click();
    const progress = page.getByTestId("generation-task-progress");
    await expect(progress.getByRole("status")).toHaveText(locale === "zh" ? "模型生成" : "Model generation");
    await expect(progress.locator("li", { hasText: locale === "zh" ? "提交生成任务" : "Submit generation" })).toContainText(locale === "zh" ? "已完成" : "Done");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    polling = "offline";
    await expect(progress.getByRole("status")).toHaveText(locale === "zh" ? "状态同步中断" : "Status sync interrupted", { timeout: 10000 });
    polling = "working";
    await expect(progress.getByRole("status")).toHaveText(locale === "zh" ? "模型生成" : "Model generation", { timeout: 10000 });
    if (locale === "zh") await progress.screenshot({ path: testInfo.outputPath("generation-progress.png") });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(progress.getByRole("status")).toHaveText(locale === "zh" ? "模型生成" : "Model generation");
    polling = "complete";
    await expect(progress.getByRole("status")).toHaveText(locale === "zh" ? "结果就绪" : "Result ready", { timeout: 10000 });
    await expect(page.locator("video").first()).toHaveAttribute("src", "https://media.example.test/video.mp4");
    expect(submissions).toBe(1);
  });
}

test("a submission failure keeps later steps unstarted and stops the timer", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: "2099-01-01T00:00:00Z" } };
    else if (path === "/api/commercial/config") body = { commercialConsumptionEnabled: true };
    else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, commercial: { credits: 650 } };
    else if (path === "/api/generation-history") body = { history: [] };
    else if (path === "/api/generation-jobs") {
      await route.fulfill({ contentType: "application/x-ndjson", body: [
        { type: "stage", stage: "preparing" }, { type: "stage", stage: "submitting" },
        { type: "result", status: 503, body: { code: "UPSTREAM_UNAVAILABLE", error: "视频生成服务暂时不可用，请稍后重试。" } },
      ].map(item => JSON.stringify(item)).join("\n") });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/dashboard?tab=video-gen&duration=5&videoGenPrompt=A%20cat%20in%20sunlight", { waitUntil: "domcontentloaded" });
  await page.getByLabel("费用来源").selectOption("byok");
  await page.getByRole("button", { name: /^生成视频/ }).click();
  const progress = page.getByTestId("generation-task-progress");
  await expect(progress.getByRole("status")).toHaveText("生成未完成");
  await expect(progress.locator('[aria-current="step"]')).toContainText("提交生成任务");
  await expect(progress.locator('[aria-current="step"]')).toContainText("失败");
  await expect(progress.locator("li", { hasText: "模型生成" })).toContainText("未执行");
  await expect(progress).not.toContainText("100%");
});
