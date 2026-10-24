import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("video edit development status", () => {
  it("shows a localized development badge on a disabled dashboard tab", async () => {
    const [dashboard, zh, en] = await Promise.all([
      readFile(new URL("app/dashboard/page.tsx", root), "utf8"),
      readFile(new URL("i18n/messages/zh.json", root), "utf8").then(JSON.parse),
      readFile(new URL("i18n/messages/en.json", root), "utf8").then(JSON.parse),
    ]);

    expect(dashboard).toMatch(/key: "edit"[\s\S]*?disabled: true[\s\S]*?status: t\("dashboard\.tabs\.inDevelopment"\)/);
    expect(dashboard).toContain("disabled={tab.disabled}");
    expect(zh.dashboard.tabs.inDevelopment).toBe("开发中");
    expect(en.dashboard.tabs.inDevelopment).toBe("In development");
  });

  it("does not import or render the video editor in the dashboard", async () => {
    const dashboard = await readFile(
      new URL("app/dashboard/page.tsx", root),
      "utf8",
    );

    expect(dashboard).not.toContain('import { VideoEditTab }');
    expect(dashboard).not.toContain("<VideoEditTab");
  });
});
