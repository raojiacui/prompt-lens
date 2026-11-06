import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const shell = process.platform === "win32"
  ? join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe")
  : "/bin/sh";
const testProject = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
const liveProject = "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV";

describe("Vercel Git build isolation", () => {
  const cases: [string, string, string, string, number][] = [
    ["V2 Git production", testProject, "prompt-lens-V2", "production", 1],
    ["V2 preview", testProject, "prompt-lens-V2", "preview", 1],
    ["V2 explicit manual recovery", testProject, "", "production", 1],
    ["main in test project", testProject, "main", "production", 0],
    ["other branch in test project", testProject, "feature/example", "preview", 0],
    ["authorized main release", liveProject, "main", "production", 1],
    ["V2 in live production", liveProject, "prompt-lens-V2", "production", 0],
    ["V2 in live preview", liveProject, "prompt-lens-V2", "preview", 0],
    ["other live branch", liveProject, "feature/example", "production", 0],
    ["manual live upload", liveProject, "", "production", 0],
    ["main live preview", liveProject, "main", "preview", 0],
    ["live environment missing", liveProject, "main", "", 0],
    ["unknown project", "prj_unknown", "main", "production", 0],
    ["project missing", "", "prompt-lens-V2", "production", 0],
    ["all metadata missing", "", "", "", 0],
  ];

  it.each(cases)("%s", (_label, project, branch, environment, status) => {
    const result = spawnSync(shell, ["-c", config.ignoreCommand], {
      env: { ...process.env, VERCEL_PROJECT_ID: project, VERCEL_GIT_COMMIT_REF: branch, VERCEL_ENV: environment },
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status); // Vercel: 1 builds; 0 skips.
  });
});
