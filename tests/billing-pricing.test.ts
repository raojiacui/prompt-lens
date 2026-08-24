import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES, getCreditPackage } from "@/lib/billing/credit-packages";
import { getVideoGenerationChargeUnits } from "@/lib/billing/video-generation";

describe("Billing packages", () => {
  it("keeps video analysis packages scoped away from platform video generation", () => {
    const analysisOnlyPackages = CREDIT_PACKAGES.filter((pkg) => pkg.id !== "creation_360");

    expect(analysisOnlyPackages.length).toBeGreaterThan(0);
    for (const pkg of analysisOnlyPackages) {
      expect(pkg.scopes).toContain("video_analysis");
      expect(pkg.scopes).not.toContain("video_generation");
    }
  });

  it("offers the creation pack for platform video analysis and generation", () => {
    const creationPack = getCreditPackage("creation_360");

    expect(creationPack).toMatchObject({
      credits: 360,
      priceCny: 199,
    });
    expect(creationPack?.scopes).toEqual(expect.arrayContaining(["video_analysis", "video_generation"]));
  });
});

describe("Video generation credit pricing", () => {
  it("charges by model family and duration for common KIE video generation models", () => {
    expect(getVideoGenerationChargeUnits({ modelId: "bytedance/seedance-2", duration: 10 })).toBe(16);
    expect(getVideoGenerationChargeUnits({ modelId: "kling-3.0/video", duration: 10 })).toBe(18);
    expect(getVideoGenerationChargeUnits({ modelId: "veo3_fast", duration: 8 })).toBe(24);
    expect(getVideoGenerationChargeUnits({ modelId: "sora-2/text-to-video", duration: 10 })).toBe(30);
  });

  it("keeps low-cost Wan generation above the minimum generation charge", () => {
    expect(getVideoGenerationChargeUnits({ modelId: "wan/2-6-text-to-video", duration: 4 })).toBe(12);
    expect(getVideoGenerationChargeUnits({ modelId: "wan/2-6-text-to-video", duration: 10 })).toBe(13);
  });

  it("charges video edit models as the higher-risk fixed tier", () => {
    expect(getVideoGenerationChargeUnits({ modelId: "wan/2-7-videoedit", duration: 0 })).toBe(30);
  });
});
