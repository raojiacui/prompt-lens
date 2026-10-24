import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runtimeFiles = [
  "app/api/audio-analyze/route.ts",
  "app/api/video-edit/route.ts",
  "lib/ai/analyzer.ts",
  "lib/ai/chat.ts",
  "lib/ai/provider-error.ts",
  "lib/ai/video-editor.ts",
  "lib/audio-processor/llm-segmenter.ts",
];

describe("legacy URL parser removal", () => {
  it("keeps Axios and follow-redirects out of production dependencies", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ));
    const lockfile = await readFile(
      new URL("../pnpm-lock.yaml", import.meta.url),
      "utf8",
    );

    expect(packageJson.dependencies).not.toHaveProperty("axios");
    expect(lockfile).not.toContain("follow-redirects@");
  });

  it.each(runtimeFiles)("does not import Axios from %s", async (file) => {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["']axios["']/u);
  });
});
