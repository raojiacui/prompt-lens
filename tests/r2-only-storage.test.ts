import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("R2-only storage architecture", () => {
  it("does not ship the Vercel Blob dependency", () => {
    const packageJson = JSON.parse(read("package.json"));
    expect(packageJson.dependencies?.["@vercel/blob"]).toBeUndefined();
  });

  it("uses R2 names for the browser client and upload routes", () => {
    expect(existsSync(new URL("../lib/r2-client.ts", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../app/api/upload-r2/route.ts", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../lib/vercel-blob-client.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../app/api/upload-b2/route.ts", import.meta.url))).toBe(false);
  });

  it("does not fall back to legacy B2 credentials or URL formats", () => {
    const r2Storage = read("lib/cloudflare/r2.ts");
    const videoEditor = read("lib/video-processor/editor.ts");
    expect(`${r2Storage}\n${videoEditor}`).not.toMatch(/B2_|backblazeb2|ToB2|FromB2/);
  });
});
