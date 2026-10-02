import { describe, expect, it } from "vitest";
import { readableVideoOverview } from "@/lib/workflow/video-overview";
import sampleSnapshot from "@/lib/samples/public-workflow-samples.snapshot.json";

const scene = (sceneIndex: number, summary: string) => ({ sceneIndex, story: { summary }, visual: { sceneDescription: "剑客站在龙影下。", style: "电影质感", color: "冷色调" }, transition: { editing: { pacing: "缓慢沉重" } } });

describe("readable video interpretation", () => {
  it("replaces generic workflow text with ordered real scene descriptions", () => {
    const result = readableVideoOverview({ narrative: "The video is prepared as 8 editable scene blueprint units.", metadata: { secret: "hidden" }, editingRhythm: "Follow detected scene boundaries and preserve timing during remix/generation." }, [scene(2, "龙影消散。"), scene(1, "镜头 01 覆盖 0.0s-1.5s，生成前需要结合提取的视频片段或关键帧复核。")]);
    expect(result.paragraphs).toEqual(["剑客站在龙影下。", "龙影消散。"]);
    expect(result.style).toBe("电影质感 冷色调");
    expect(result.rhythm).toBe("缓慢沉重");
    expect(JSON.stringify(result)).not.toContain("hidden");
  });
  it("uses genuine whole-video narrative when available", () => {
    expect(readableVideoOverview({ narrative: "剑客面对巨龙，最后转身离去。" }, [scene(1, "开场")]).paragraphs).toEqual(["剑客面对巨龙，最后转身离去。"]);
  });
  it("does not turn failed analysis placeholders into interpretation", () => {
    const result = readableVideoOverview({}, [{ ...scene(1, "不可用"), metadata: { analysisProvider: "fallback" } }]);
    expect(result).toMatchObject({ paragraphs: [], style: "", rhythm: "", partial: true });
  });
  it("filters template instructions from descriptions, style and rhythm", () => {
    const result = readableVideoOverview({}, [{
      ...scene(1, ""),
      visual: {
        sceneDescription: "Describe every visible element in the frame precisely enough for text-to-video recreation.",
        style: "Reference-video style, realism level, texture, format, platform aesthetic, and production quality",
        color: "Dominant palette, saturation, contrast, color temperature, skin/object tones, and grading style",
      },
      transition: { editing: { pacing: "Describe cut speed, beat placement, and whether this is a fast cut, normal cut, or held shot." } },
    }]);
    expect(result).toMatchObject({ paragraphs: [], style: "", rhythm: "" });
  });
  it("keeps real descriptions in fields mixed with template sentences", () => {
    const result = readableVideoOverview({
      narrative: "剑客站在龙影下。 Describe every visible element in the frame precisely enough for text-to-video recreation. 龙影逐渐消散。",
      editingRhythm: "Preserve original edit timing and scene duration. Slow cuts follow the character's steps.",
    }, []);
    expect(result.paragraphs).toEqual(["剑客站在龙影下。 龙影逐渐消散。"]);
    expect(result.rhythm).toBe("Slow cuts follow the character's steps.");
  });
  it("falls back to a genuine story description and preserves English analysis", () => {
    const result = readableVideoOverview({ narrative: "N/A" }, [{
      ...scene(1, "待分析"),
      story: { summary: "待分析", sceneDescription: "A swordsman walks across the courtyard. The camera tracks him from behind." },
    }]);
    expect(result.paragraphs).toEqual(["A swordsman walks across the courtyard. The camera tracks him from behind."]);
  });
  it("removes known template text from all existing public sample interpretations", () => {
    for (const sample of sampleSnapshot) {
      const result = readableVideoOverview(sample.activeVersion.overview, sample.sceneVersions);
      const output = JSON.stringify(result);
      expect(output).not.toMatch(/Describe every visible element|Describe cut speed|Reference-video style|Dominant palette/);
      expect(result.paragraphs.length).toBeGreaterThan(0);
    }
  });
});
