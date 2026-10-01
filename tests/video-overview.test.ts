import { describe, expect, it } from "vitest";
import { readableVideoOverview } from "@/lib/workflow/video-overview";

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
});
