import { describe, expect, it } from "vitest";
import { buildRecreationPrompt } from "@/lib/workflow/recreation-prompt";

describe("complete generation prompt", () => {
  const scene = { generationPrompt: "男子走过长廊。", visual: { characters: "黑色西装、白色衬衫", environment: "云海与雕花栏杆", action: "沿长廊缓步前行", camera: "低机位广角跟拍", lighting: "清晨逆光", color: "暖色调", style: "电影质感" } };
  it("includes every visual constraint in the final copyable text", () => {
    const prompt = buildRecreationPrompt(scene);
    for (const value of Object.values(scene.visual)) expect(prompt).toContain(value);
    expect(prompt).not.toContain("分析拆解");
  });
  it("does not duplicate details already in the prompt", () => {
    const result = buildRecreationPrompt({ ...scene, generationPrompt: "男子走过长廊。清晨逆光" });
    expect(result.split("清晨逆光")).toHaveLength(2);
  });
  it("preserves a saved user-edited prompt without reattaching old analysis", () => {
    expect(buildRecreationPrompt({ ...scene, generationPrompt: "女子穿红裙。", metadata: { recreationPromptVersion: 1 } })).toBe("女子穿红裙。");
  });
  it("does not invent a successful prompt for failed analysis", () => {
    expect(buildRecreationPrompt({ ...scene, generationPrompt: "", metadata: { analysisProvider: "fallback" } })).toBe("");
  });
  it("formats structured visual constraints without JSON or language switching", () => {
    expect(buildRecreationPrompt({ generationPrompt: "A tracking shot.", visual: { camera: { movement: "slow dolly", framing: "wide angle" } } })).toBe("A tracking shot.\n\nCamera and composition: slow dolly; wide angle");
  });
});
