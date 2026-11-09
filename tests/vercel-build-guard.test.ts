import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const testProject = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
const liveProject = "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV";
const script = resolve("scripts/vercel-ignore-build.mjs");

describe("Vercel release build boundary", () => {
  it.each([
    [testProject, "prompt-lens-V2", "production", 1],
    [liveProject, "prompt-lens-V2", "production", 1],
    [testProject, "main", "production", 0],
    [liveProject, "main", "production", 0],
    [testProject, "feature/change", "production", 0],
    [liveProject, "feature/change", "production", 0],
    [testProject, "", "production", 0],
    [liveProject, "", "production", 0],
    [testProject, "prompt-lens-V2", "preview", 0],
    [liveProject, "prompt-lens-V2", "preview", 0],
    [testProject, "prompt-lens-V2", "development", 0],
    [liveProject, "prompt-lens-V2", "development", 0],
    [testProject, "prompt-lens-V2", "", 0],
    [liveProject, "prompt-lens-V2", "", 0],
    ["prj_unrelated", "prompt-lens-V2", "production", 0],
    ["", "prompt-lens-V2", "production", 0],
    [testProject, "prompt-lens-v2", "production", 0],
    [liveProject, "prompt-lens-V2", "Production", 0],
  ])("%s / %s / %s exits %i", (project, branch, environment, expected) => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, VERCEL_PROJECT_ID: String(project), VERCEL_GIT_COMMIT_REF: String(branch), VERCEL_ENV: String(environment) },
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(expected);
  });

  it("uses the checked script without exceeding the Vercel command length limit", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
    expect(config.ignoreCommand.length).toBeLessThanOrEqual(256);
  });

  it("pins the next V2 deployment to the approved Node 24 major", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines.node).toBe("24.x");
  });
});
