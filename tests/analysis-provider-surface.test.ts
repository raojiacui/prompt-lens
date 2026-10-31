import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("analysis provider surface", () => {
  it("preserves the public model options and key restrictions", () => {
    const dashboard = read("app/dashboard/page.tsx");
    const modelOptions = [...dashboard.matchAll(/<option value="((?:deepseek|gemini)-[^"]+)"[^>]*>/g)].map(match => match[1]);
    expect(modelOptions).toEqual(["deepseek-v4-flash", "gemini-3.8-flash"]);
    expect(dashboard).toContain('>("platform-deepseek-v4-flash")');
    expect(dashboard).toContain('value="kie" disabled={!trialAccess?.hasOwnApiKey}');
    expect(dashboard).toContain('disabled={isLoading || trialAccessLoading}');

  });

  it("only lets users configure KIE in settings", () => {
    const settings = read("components/api-key-settings.tsx");
    const route = read("app/api/settings/api-key/route.ts");

    expect(settings).toContain('body: JSON.stringify({ provider: "kie"');
    expect(settings).toContain('t("kieName")');
    expect(settings).not.toContain('t("openrouterName")');
    expect(settings).not.toMatch(/<option value="(openrouter|zhipu|gemini)">/);
    expect(route).toContain('if (provider !== "kie")');
  });

  it("does not count user-funded KIE history against the platform trial", () => {
    const quota = read("lib/usage/trial-quota.ts");

    expect(quota).not.toContain("analysisHistory");
    expect(quota).toContain("metadata}->>'apiKeySource' = 'platform'");
  });

  it("checks platform quota on the server even when the client requests the platform model", () => {
    const route = read("app/api/analyze/route.ts");
    const quota = read("lib/usage/trial-quota.ts");

    expect(route).toContain("await assertTrialQuota(session.user.id)");
    expect(route).toContain('status: 402');
    expect(quota).toContain('code: "TRIAL_QUOTA_EXCEEDED"');
  });
});
