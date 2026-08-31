import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES, getCreditPackage } from "@/lib/billing/credit-packages";

describe("Billing packages", () => {
  it("keeps all purchasable packages scoped to video analysis only", () => {
    expect(CREDIT_PACKAGES.length).toBeGreaterThan(0);
    for (const pkg of CREDIT_PACKAGES) {
      expect(pkg.scopes).toContain("video_analysis");
      expect(pkg.scopes).not.toContain("video_generation");
    }
  });

  it("does not offer a platform video generation creation pack", () => {
    expect(getCreditPackage("creation_360")).toBeNull();
  });
});