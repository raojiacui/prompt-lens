import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("OAuth login surface", () => {
  it("uses the Better Auth client and prevents concurrent sign-in attempts", async () => {
    const clientSource = await readFile(
      new URL("../app/login/login-client.tsx", import.meta.url),
      "utf8",
    );
    const pageSource = await readFile(
      new URL("../app/login/page.tsx", import.meta.url),
      "utf8",
    );

    expect(clientSource).toContain("signIn.social");
    expect(clientSource).not.toContain("/api/auth/sign-in/social");
    expect(clientSource).toContain("disabled={oauthProvider !== null}");
    expect(clientSource).toContain("redirectToCanonicalOrigin(authBaseURL)");
    expect(clientSource).toContain("window.location.replace");
    expect(pageSource).toContain("authBaseURL={getAuthBaseURL()}");
  });

  it("uses a Better Auth release containing OAuth state-cookie fixes", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ));

    expect(packageJson.dependencies["better-auth"]).toBe("1.6.2");
  });
});
