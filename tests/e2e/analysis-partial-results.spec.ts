import { test, expect } from "@playwright/test";

for (const locale of ["zh", "en"]) for (const width of [1440, 390]) {
  test(`shows completed shots during analysis ${locale} ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
    const projectId = "11111111-1111-4111-8111-111111111111";
    const taskId = "22222222-2222-4222-8222-222222222222";
    let delivered = 1;
    let polls = 0;
    let confirmations = 0;
    const scenes = [1, 2].map(index => ({ id: `shot-${index}`, sceneIndex: index, startTime: (index - 1) * 5, endTime: index * 5, duration: 5, keyframeUrls: [], status: "completed" }));
    const versions = [1, 2].map(index => ({ id: `result-${index}`, originalSceneId: `shot-${index}`, projectVersionId: "version", sceneIndex: index, duration: 5, generationPrompt: `Completed prompt ${index}`, story: {}, visual: {}, dialogue: [], subtitle: [], audio: {}, transition: {}, metadata: { analysisProvider: "kie", recreationPromptVersion: 1 } }));
    const activeVersion = { id: "version", label: "Original", versionNumber: 0, kind: "original", overview: {} };
    const bundle = () => ({ project: { id: projectId, title: "Progressive results", status: delivered === 2 ? "ready" : "analyzing", metadata: { mediaType: "video" } }, versions: [activeVersion], activeVersion, scenes, sceneVersions: versions.slice(0, delivered), allSceneVersions: versions.slice(0, delivered) });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, mode: "byok", hasUserKieKey: true, trial: { remaining: 0 }, commercial: { enabled: true, credits: 200 }, linkImports: { remaining: 10 } };
      else if (path === "/api/models") body = { models: [] };
      else if (path === "/api/workflow/projects") body = route.request().method() === "POST" ? { project: { id: projectId } } : { projects: [] };
      else if (path === "/api/media/resolve-link") body = { mediaUrl: "https://example.com/video.mp4", filename: "video.mp4", mediaType: "video", platform: "douyin" };
      else if (path === "/api/commercial/analysis") body = route.request().postDataJSON().action === "prepare" ? { id: "preview", durationUs: 10000000, scenes: [1, 2].map(index => ({ id: String(index), startUs: (index - 1) * 5000000, endUs: index * 5000000 })) } : { id: taskId, credits: 8, splitCredits: 2, analysisCredits: 6 };
      else if (path === `/api/commercial/tasks/${taskId}`) {
        if (route.request().method() === "POST") { confirmations++; body = { id: taskId, state: "queued" }; }
        else { polls++; body = { id: taskId, state: delivered === 2 ? "completed" : "running", phase: "analyzing", completedScenes: delivered, totalScenes: 2, bundle: bundle() }; }
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: locale === "zh" ? "粘贴链接" : "Paste link" }).click();
    await page.getByLabel(locale === "zh" ? "视频链接" : "Video link", { exact: true }).fill("https://v.douyin.com/test/");
    await page.getByTestId("analysis-action-row").getByRole("button").click();
    await page.getByRole("button", { name: locale === "zh" ? "确认分析 · 8 积分" : "Confirm analysis · 8 credits" }).click();
    const first = page.locator("#recreation-prompt-result-1");
    await expect(first).toHaveValue("Completed prompt 1");
    await expect(page.locator("#recreation-prompt-result-2")).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toBeVisible();
    await first.fill("My edited prompt");
    const currentPolls = polls;
    await expect.poll(() => polls).toBeGreaterThan(currentPolls);
    await expect(first).toHaveValue("My edited prompt");
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/partial-analysis-${locale}-${width}.png` });
    delivered = 2;
    await expect(page.locator("#recreation-prompt-result-2")).toHaveValue("Completed prompt 2", { timeout: 15000 });
    await expect(first).toHaveValue("My edited prompt");
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    expect(confirmations).toBe(1);
  });
}
