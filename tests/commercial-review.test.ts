import { describe, expect, it } from "vitest";
import { canFullyReleaseTask } from "@/lib/billing/commercial-review";

describe("manual full release eligibility", () => {
  it("protects active tasks and delivered analysis from a full release", () => {
    expect(canFullyReleaseTask(undefined)).toBe(false);
    expect(canFullyReleaseTask({ state: "running", kind: "analysis", result: {} })).toBe(false);
    expect(canFullyReleaseTask({ state: "review", kind: "analysis", result: { review: {}, successfulSceneIds: ["1"] } })).toBe(false);
    expect(canFullyReleaseTask({ state: "review", kind: "analysis", result: { review: {}, successfulSceneIds: [], splitDelivered: true } })).toBe(false);
    expect(canFullyReleaseTask({ state: "review", kind: "analysis", result: { review: {}, pendingResult: { sceneId: "1" } } })).toBe(false);
    expect(canFullyReleaseTask({ state: "review", kind: "generation", result: {} })).toBe(false);
  });

  it("allows reviewed tasks without delivered analysis to be released after evidence review", () => {
    expect(canFullyReleaseTask({ state: "review", kind: "analysis", result: { review: {}, successfulSceneIds: [] } })).toBe(true);
  });
});
