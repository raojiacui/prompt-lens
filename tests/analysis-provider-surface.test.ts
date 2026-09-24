import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("analysis provider surface", () => {
  it("shows only platform OpenRouter and user KIE on the analysis page", () => {
    const dashboard = read("app/dashboard/page.tsx");
    const providerOptions = [...dashboard.matchAll(/<option value="(openrouter|kie|zhipu|gemini)">/g)]
      .map((match) => match[1]);

    expect(providerOptions).toEqual(["openrouter", "kie"]);
  });

  it("only lets users configure KIE in settings", () => {
    const settings = read("components/api-key-settings.tsx");
    const route = read("app/api/settings/api-key/route.ts");

    expect(settings).toContain('body: JSON.stringify({ provider: "kie"');
    expect(settings).not.toMatch(/<option value="(openrouter|zhipu|gemini)">/);
    expect(route).toContain('if (provider !== "kie")');
  });

  it("does not count user-funded KIE history against the platform trial", () => {
    const quota = read("lib/usage/trial-quota.ts");

    expect(quota).not.toContain("analysisHistory");
    expect(quota).toContain("metadata}->>'apiKeySource' = 'platform'");
  });
});
