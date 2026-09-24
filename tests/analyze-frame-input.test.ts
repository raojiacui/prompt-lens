import { describe, expect, it } from "vitest";
import { resolveAnalysisFrames } from "@/lib/ai/analysis-frame-input";

describe("resolveAnalysisFrames", () => {
  it("accepts only frame URLs owned by the current user", () => {
    const result = resolveAnalysisFrames({
      userId: "user-1",
      frameUrls: [
        "https://media.example/analysis-frames/user-1/run-1/frame-01.jpg",
        "https://media.example/analysis-frames/user-1/run-1/frame-02.jpg",
      ],
      clientFrames: undefined,
      extractKey: (url) => new URL(url).pathname.slice(1),
    });

    expect(result.frames).toHaveLength(2);
    expect(result.temporaryKeys).toEqual([
      "analysis-frames/user-1/run-1/frame-01.jpg",
      "analysis-frames/user-1/run-1/frame-02.jpg",
    ]);
  });

  it("rejects another user's frame URL", () => {
    expect(() => resolveAnalysisFrames({
      userId: "user-1",
      frameUrls: ["https://media.example/analysis-frames/user-2/run-1/frame-01.jpg"],
      clientFrames: undefined,
      extractKey: (url) => new URL(url).pathname.slice(1),
    })).toThrow("Invalid analysis frame URL");
  });

  it("keeps small legacy data URLs but rejects a large request body", () => {
    const small = "data:image/jpeg;base64," + "a".repeat(100);
    expect(resolveAnalysisFrames({
      userId: "user-1",
      frameUrls: undefined,
      clientFrames: [small],
      extractKey: () => null,
    }).frames).toEqual([small]);

    const large = "data:image/jpeg;base64," + "a".repeat(4 * 1024 * 1024 + 1);
    expect(() => resolveAnalysisFrames({
      userId: "user-1",
      frameUrls: undefined,
      clientFrames: [large],
      extractKey: () => null,
    })).toThrow("Legacy frame payload is too large");
  });
});
