import { describe, expect, it } from "vitest";
import { isDeferredDashboardFeature } from "@/lib/dashboard-feature-policy";

describe("dashboard release features", () => {
  it("disables unfinished audio and editing entries including deep links", () => {
    expect(isDeferredDashboardFeature("audio")).toBe(true);
    expect(isDeferredDashboardFeature("edit")).toBe(true);
  });
  it("keeps released workflows and account tools available", () => {
    for (const tab of [null,"home","analyze","video-gen","history","settings","admin"]) {
      expect(isDeferredDashboardFeature(tab)).toBe(false);
    }
  });
});
