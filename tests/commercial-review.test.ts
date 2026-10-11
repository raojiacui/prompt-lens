import { describe, expect, it } from "vitest";
import { canFullyReleaseTask } from "@/lib/billing/commercial-review";

describe("manual full release eligibility", () => {
  it("protects active tasks and delivered analysis from a full release", () => {
    expect(canFullyReleaseTask(undefined)).toBe(false);
    expect(canFullyReleaseTask({ state: "running", kind: "analysis", result: {} })).toBe(false);
    expect(canFullyReleaseTask({ state: "review", kind: "analysis", result: { successfulSceneIds: ["1"] } })).toBe(false);
  });

  it("allows reviewed tasks without delivered analysis to be released after evidence review", () => {
    expect(canFullyReleaseTask({ state: "review", kind: "analysis", result: { successfulSceneIds: [] } })).toBe(true);
    expect(canFullyReleaseTask({ state: "review", kind: "generation", result: {} })).toBe(true);
  });
});
