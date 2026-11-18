import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, moderationTerms: {}, moderationRecords: {} }));
import { normalizeTerm, termMatches, evaluateTerms } from "@/lib/safety/moderation-controls";

describe("dynamic moderation terminology", () => {
  it("normalizes Unicode widths and case without mutating original prompts", () => {
    expect(normalizeTerm("  ＦＡＣＥ  SWAP  ")).toBe("face swap");
    expect(termMatches("Ａ face swap instruction", "face swap")).toBe(true);
  });
  it("respects boundaries for Latin terms but supports CJK substrings", () => {
    expect(termMatches("classical music", "ass")).toBe(false);
    expect(termMatches("一个换脸视频", "换脸")).toBe(true);
    expect(termMatches("deep nude", "deep nude")).toBe(true);
  });
  it("prioritizes blocking over manual review and leaves safe content alone", () => {
    const terms = [
      { id: "review", normalizedPhrase: "face swap", category: "deepfake", action: "review" },
      { id: "block", normalizedPhrase: "deep nude", category: "deepfake", action: "block" },
    ];
    expect(evaluateTerms("face swap then deep nude", terms)).toEqual({ id: "block", category: "deepfake", action: "block" });
    expect(evaluateTerms("landscape video", terms)).toBeNull();
  });
});
