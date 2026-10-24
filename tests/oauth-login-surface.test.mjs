import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("OAuth login surface", () => {
  it("uses the Better Auth client and prevents concurrent sign-in attempts", async () => {
    const source = await readFile(
      new URL("../app/login/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("signIn.social");
    expect(source).not.toContain("/api/auth/sign-in/social");
    expect(source).toContain("disabled={oauthProvider !== null}");
  });

  it("uses a Better Auth release containing OAuth state-cookie fixes", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ));

    expect(packageJson.dependencies["better-auth"]).toBe("1.6.2");
  });
});
