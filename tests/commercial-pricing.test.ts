import { describe, expect, it } from "vitest";
import { COMMERCIAL_PACKAGES, quoteAnalysis, settleAnalysis, retryAnalysisCredits, splitCredits, estimateGeneration, type AnalysisPriceInput } from "@/lib/billing/pricing-v6";

function analysis(seconds: number, count: number, model: "flash" | "pro" = "flash"): AnalysisPriceInput {
  return { payer: "platform", model, sourceDurationUs: seconds * 1e6, automaticSplit: true, paidSplitReusable: false,
    scenes: Array.from({ length: count }, (_, index) => ({ id: String(index), startUs: index * seconds * 1e6 / count, endUs: (index + 1) * seconds * 1e6 / count })) };
}

describe("V6 commercial pricing", () => {
  it("keeps approved packages distinct from historical credits", () => {
    expect(COMMERCIAL_PACKAGES.map((pack) => [pack.priceCents, pack.credits, pack.rewrites])).toEqual([[1990, 200, 20], [5900, 650, 60], [12900, 1500, 150]]);
    expect(COMMERCIAL_PACKAGES.every((pack) => pack.id.startsWith("v6_"))).toBe(true);
  });
  it.each([[1, 1], [6_000_000, 1], [6_000_001, 2], [15_000_000, 3], [30_000_000, 5], [30_000_001, 6], [40_000_000, 7], [60_000_000, 10]])("split duration %i costs %i", (duration, expected) => {
    expect(splitCredits(duration)).toBe(expected);
  });
  it.each([0, -1, NaN, Infinity, .1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid duration %s", (duration) => {
    expect(() => splitCredits(duration)).toThrow();
  });
  it.each([[2, 1, 3, 4], [10, 1, 7, 9], [30, 10, 27, 40], [40, 20, 43, 67], [60, 20, 54, 80], [60, 6, 40, 52]])("quotes %is/%i scenes", (seconds, count, flash, pro) => {
    expect(quoteAnalysis(analysis(seconds, count)).credits).toBe(flash);
    expect(quoteAnalysis(analysis(seconds, count, "pro")).credits).toBe(pro);
  });
  it("charges only selected analysis duration while retaining the full split fee", () => {
    const input = analysis(60, 5);
    input.scenes = Array.from({ length: 5 }, (_, index) => ({ id: String(index), startUs: index * 2e6, endUs: (index + 1) * 2e6 }));
    expect(quoteAnalysis(input).credits).toBe(19);
    expect(quoteAnalysis({ ...input, model: "pro" }).credits).toBe(25);
    expect(quoteAnalysis({ ...input, paidSplitReusable: true }).credits).toBe(9);
  });
  it("does not round each short scene separately", () => {
    const input = analysis(2, 2);
    expect(quoteAnalysis(input).credits).toBe(4);
    const first = settleAnalysis(input, ["0"], true);
    expect(first).toBe(3);
    expect(retryAnalysisCredits(input, ["0"], ["0", "1"])).toBe(1);
  });
  it("settles only successful scenes and refunds an entirely failed platform batch", () => {
    const input = analysis(60, 20);
    const ids = input.scenes.slice(0, 10).map((scene) => scene.id);
    expect(settleAnalysis(input, ids, true)).toBe(32);
    expect(settleAnalysis({ ...input, model: "pro" }, ids, true)).toBe(45);
    expect(settleAnalysis(input, [], true)).toBe(0);
    expect(settleAnalysis({ ...input, payer: "byok_split" }, [], true)).toBe(10);
    expect(settleAnalysis({ ...input, payer: "byok_split" }, [], false)).toBe(0);
  });
  it("quotes manual upload and explicit BYOK correctly", () => {
    const input = { ...analysis(2, 1), automaticSplit: false };
    expect(quoteAnalysis(input).credits).toBe(2);
    expect(quoteAnalysis({ ...input, model: "pro" }).credits).toBe(3);
    expect(quoteAnalysis({ ...input, payer: "byok" }).credits).toBe(0);
    expect(() => quoteAnalysis({ ...input, payer: "byok", automaticSplit: true })).toThrow();
  });
  it("rejects empty, duplicate, overlapping, out-of-bounds and over-limit scenes", () => {
    const input = analysis(2, 1);
    for (const scenes of [[], [input.scenes[0], input.scenes[0]], [{ id: "x", startUs: 0, endUs: 3e6 }], [{ id: "x", startUs: -1, endUs: 1e6 }]]) {
      expect(() => quoteAnalysis({ ...input, scenes })).toThrow();
    }
    expect(() => quoteAnalysis(analysis(90, 10))).toThrow();
    expect(() => quoteAnalysis(analysis(42, 21))).toThrow();
    expect(() => settleAnalysis(input, ["missing"], true)).toThrow();
    expect(() => settleAnalysis(input, ["0", "0"], true)).toThrow();
    expect(() => settleAnalysis(input, ["0"], false)).toThrow();
    expect(() => retryAnalysisCredits(input, ["0"], [])).toThrow();
  });
  it.each([
    ["grok-imagine/text-to-video", "720p", 6, false, 40],
    ["grok-imagine/text-to-video", "720p", 10, false, 65],
    ["bytedance/seedance-2-mini", "480p", 5, false, 30],
    ["bytedance/seedance-2-mini", "720p", 10, false, 110],
    ["wan/2-6-text-to-video", "720p", 5, false, 95],
    ["kling-2.6/text-to-video", "1080p", 10, true, 290],
    ["kling-3.0/video", "1080p", 5, true, 180],
    ["bytedance/seedance-2-fast", "720p", 5, true, 165],
    ["bytedance/seedance-2", "1080p", 10, true, 1320],
  ] as const)("estimates %s %s %is", (modelId, resolution, durationSeconds, audio, expected) => {
    expect(estimateGeneration({ modelId, resolution, durationSeconds, audio })).toMatchObject({ credits: expected, adapterVerified: false });
  });
  it("includes reference video duration and rejects unpriced combinations", () => {
    expect(estimateGeneration({ modelId: "bytedance/seedance-2-fast", resolution: "720p", durationSeconds: 10, audio: true, referenceVideoSeconds: 5 }).credits).toBe(295);
    for (const modelId of ["veo3_fast", "sora-2/text-to-video", "unknown"]) {
      expect(() => estimateGeneration({ modelId, resolution: "720p", durationSeconds: 10, audio: false })).toThrow("MODEL_PRICE_UNVERIFIED");
    }
    expect(() => estimateGeneration({ modelId: "bytedance/seedance-2-fast", resolution: "1080p", durationSeconds: 10, audio: true })).toThrow();
  });
});
