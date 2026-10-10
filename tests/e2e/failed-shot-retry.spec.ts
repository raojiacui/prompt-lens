import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`retries only a failed shot with the same quote after a lost response ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    const projectId = "11111111-1111-4111-8111-111111111111";
    const parentId = "22222222-2222-4222-8222-222222222222";
    const retryId = "33333333-3333-4333-8333-333333333333";
    let quotes = 0;
    let polls = 0;
    const confirmations: string[] = [];
    const bundle = (retried = false) => {
      const project = { id: projectId, title: "Failed shots", status: "ready", updatedAt: new Date().toISOString(), metadata: { mediaType: "video", analysisTaskId: retried ? retryId : parentId, analysisTaskKind: "analysis" } };
      const activeVersion = { id: "version", label: "Original", versionNumber: 0, kind: "original", overview: {} };
      const scenes = [1, 2, 3].map(index => ({ id: `shot-${index}`, sceneIndex: index, startTime: (index - 1) * 5, endTime: index * 5, duration: 5, keyframeUrls: [], status: index === 1 || (retried && index === 2) ? "completed" : "failed" }));
      const sceneVersions = scenes.map(scene => ({ id: `result-${scene.sceneIndex}`, originalSceneId: scene.id, projectVersionId: "version", sceneIndex: scene.sceneIndex, duration: 5, generationPrompt: scene.status === "completed" ? `Completed ${scene.sceneIndex}` : "", story: {}, visual: {}, dialogue: [], subtitle: [], audio: {}, transition: {}, metadata: { analysisProvider: scene.status === "completed" ? "kie" : "fallback", recreationPromptVersion: 1 } }));
      return { project, versions: [activeVersion], activeVersion, scenes, sceneVersions, allSceneVersions: sceneVersions };
    };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.includes("/auth/get-session")) body = { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", token: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      else if (path === "/api/credits/me") body = { commercialConsumptionEnabled: true, balance: 0, mode: "byok", hasUserKieKey: true, trial: { remaining: 0 }, commercial: { enabled: true, credits: 200 } };
      else if (path === "/api/models") body = { models: [] };
      else if (path === "/api/workflow/projects") body = { projects: [bundle(polls > 1).project] };
      else if (path === `/api/workflow/projects/${projectId}`) body = bundle();
      else if (path === "/api/commercial/analysis") {
        quotes++;
        expect(route.request().postDataJSON()).toEqual({ action: "retry", taskId: parentId, sceneVersionId: "result-2" });
        body = { id: retryId, credits: 3, sceneCount: 1, expiresAt: new Date(Date.now() + 600000).toISOString() };
      } else if (path === `/api/commercial/tasks/${retryId}`) {
        if (route.request().method() === "POST") {
          confirmations.push(path);
          if (confirmations.length === 1) { await route.fulfill({ status: 200, body: "" }); return; }
          body = { id: retryId, state: "queued" };
        } else { polls++; body = { id: retryId, state: polls > 1 ? "completed" : "running", totalScenes: 1, completedScenes: polls > 1 ? 1 : 0, bundle: polls > 1 ? bundle(true) : undefined }; }
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/dashboard?tab=analyze", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Failed shots/ }).click();
    const first = page.locator("article").filter({ has: page.locator("#recreation-prompt-result-1") });
    const second = page.locator("article").filter({ has: page.locator("#recreation-prompt-result-2") });
    const third = page.locator("article").filter({ has: page.locator("#recreation-prompt-result-3") });
    await expect(first.getByRole("button", { name: "重试", exact: true })).toHaveCount(0);
    await second.getByRole("button", { name: "重试", exact: true }).click();
    expect(confirmations).toHaveLength(0);
    await second.getByRole("button", { name: "确认重试 · 3 积分" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "提交状态尚未确认" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Failed shots/ })).toBeDisabled();
    await expect(third.getByRole("button", { name: "重试", exact: true })).toBeDisabled();
    await second.getByRole("button", { name: "确认重试 · 3 积分" }).click();
    await expect(page.locator("#recreation-prompt-result-2")).toHaveValue("Completed 2", { timeout: 15000 });
    await expect(page.locator("#recreation-prompt-result-1")).toHaveValue("Completed 1");
    await expect(third.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
    expect(quotes).toBe(1);
    expect(confirmations).toEqual([`/api/commercial/tasks/${retryId}`, `/api/commercial/tasks/${retryId}`]);
    await third.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/failed-shot-retry-${width}.png` });
  });
}
