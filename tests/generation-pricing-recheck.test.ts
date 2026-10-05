import { describe, expect, it } from "vitest";
import { estimateGeneration, GENERATION_PRICING_VERSION } from "@/lib/billing/pricing-v6";

const quote = (modelId: string, resolution: string, durationSeconds: number, referenceVideoSeconds?: number, audio = false) =>
  estimateGeneration({ modelId, resolution, durationSeconds, referenceVideoSeconds, audio });

describe("KIE price recheck 2026-10-05", () => {
  it.each([
    ["bytedance/seedance-2-mini", "480p", 19000],
    ["bytedance/seedance-2-mini", "720p", 41000],
    ["bytedance/seedance-2-fast", "720p", 124000],
    ["bytedance/seedance-2", "720p", 205000],
    ["bytedance/seedance-2", "1080p", 510000],
    ["kling-3.0/video", "720p", 70000],
    ["kling-3.0/video", "1080p", 90000],
  ])("uses official per-second cost and distinct durations for %s %s", (model, resolution, rate) => {
    const results = [4, 5, 6, 8, 10].map(seconds => quote(String(model), String(resolution), seconds));
    expect(results.map(r => r.microUsd)).toEqual([4, 5, 6, 8, 10].map(s => s * Number(rate)));
    expect(new Set(results.map(r => r.credits)).size).toBe(results.length);
    for (const result of results) {
      expect(result.credits).toBe(Math.ceil((result.microUsd / 1e6 * 7 + 0.15) / (139 / 1500)));
      expect(result.version).toBe(GENERATION_PRICING_VERSION);
    }
  });
  it("does not confuse KIE points with wallet credits", () => {
    expect(quote("bytedance/seedance-2-mini", "480p", 5)).toMatchObject({ microUsd: 95000, credits: 9 });
    expect(quote("bytedance/seedance-2", "1080p", 5)).toMatchObject({ microUsd: 2550000, credits: 195 });
  });
  it("keeps official flat Veo prices for 4, 6 and 8 seconds", () => {
    expect([4, 6, 8].map(s => quote("veo3_lite", "720p", s).credits)).toEqual([13, 13, 13]);
  });
  it("uses exact Wan duration tiers rather than one flat output fee", () => {
    expect([5, 10, 15].map(s => quote("wan/2-6-text-to-video", "1080p", s).microUsd)).toEqual([522500, 1047500, 1575000]);
  });
  it("includes input duration only for Seedance reference video", () => {
    expect(quote("bytedance/seedance-2-fast", "720p", 10, 5)).toMatchObject({ microUsd: 1125000, credits: 87 });
    expect(quote("wan/2-6-video-to-video", "720p", 10, 5).microUsd).toBe(700000);
  });
});
