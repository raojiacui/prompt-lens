import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`one detailed prompt can be copied and sent to generation at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "zh", domain: "localhost", path: "/" }]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => {
        (window as typeof window & { copiedPrompt?: string }).copiedPrompt = value;
      } } });
    });
    const project = { id: "project-1", title: "Prompt integration preview", status: "ready", updatedAt: new Date().toISOString(), activeVersionId: "version-1" };
    const version = { id: "version-1", label: "Original", versionNumber: 1, kind: "original", overview: { narrative: "The video is prepared as 8 editable scene blueprint units.", metadata: { analysisModel: "internal-model" } } };
    const scene = { id: "scene-version-1", projectVersionId: version.id, originalSceneId: "scene-1", sceneIndex: 1, story: { summary: "男子沿云海边的长廊缓步前行。" },
      visual: { characters: "黑色西装与白衬衫", camera: "低机位广角跟拍", lighting: "清晨逆光", environment: "云海与雕花栏杆", style: "电影感写实风格" },
      dialogue: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "男子走过长廊。", duration: 2 };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.includes("/auth/get-session") ? { session: { id: "test", token: "test", expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: "test", email: "test@example.com", name: "Test" } }
        : path === "/api/workflow/projects" ? { projects: [project] }
        : path === "/api/workflow/projects/project-1" ? { project, versions: [version], activeVersion: version,
          scenes: [{ id: "scene-1", sceneIndex: 1, startTime: 0, endTime: 2, duration: 2, status: "completed", keyframeUrls: [] }], sceneVersions: [scene], allSceneVersions: [scene] }
        : path === "/api/credits/me" ? { balance: 0, mode: "byok", hasUserKieKey: true, trial: { limit: 2, remaining: 2 } }
        : path === "/api/models" ? { models: [] } : {};
      await route.fulfill({ json: body });
    });
    await page.goto("/");
    await expect(page.locator('#features a[href="/dashboard?tab=audio"]')).toHaveCount(0);
    await expect(page.locator("#features video")).toHaveCount(3);
    await page.goto("/dashboard?tab=analyze");
    await page.getByRole("button", { name: /Prompt integration preview/ }).click();
    await expect(page.getByRole("heading", { name: "整片解读" })).toBeVisible();
    await expect(page.getByText("男子沿云海边的长廊缓步前行。", { exact: true })).toBeVisible();
    await expect(page.getByText("Whole Video Overview", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/editable scene blueprint units|internal-model/)).toHaveCount(0);
    const overview = page.getByRole("region", { name: "整片解读", exact: true });
    await overview.evaluate(element => {
      const paragraph = element.querySelector("p")!;
      paragraph.textContent = paragraph.textContent!.repeat(100);
    });
    expect(await overview.evaluate(element => element.clientHeight <= 256 && element.scrollHeight > element.clientHeight)).toBe(true);
    await overview.focus();
    await page.keyboard.press("End");
    await expect.poll(() => overview.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const prompt = page.getByLabel("完整复刻提示词", { exact: true });
    const original = await prompt.inputValue();
    for (const value of Object.values(scene.visual)) expect(original).toContain(value);
    await expect(page.getByText("分析拆解", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /复制|Copy/, exact: true }).click();
    expect(await page.evaluate(() => (window as typeof window & { copiedPrompt?: string }).copiedPrompt)).toBe(original);
    await page.screenshot({ path: `test-results/integrated-prompt-${width}.png`, fullPage: true });
    await prompt.fill("女子身穿红裙，在雨中行走。固定机位，柔和逆光。");
    const edited = await prompt.inputValue();
    await page.getByRole("button", { name: "做同款", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("videoGenPrompt")).toBe(edited);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
