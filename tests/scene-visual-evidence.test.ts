import { expect, it } from "vitest";
import { assertVisualEvidence, validateSceneAnalysis } from "@/lib/workflow/scene-analysis-result";

it.each([
  { sceneDescription: "未知。所有参考关键帧图片均无法打开。", subject: "未知，无可见主体图像数据。", environment: "未知", action: "未知" },
  { sceneDescription: "Images could not be loaded", subject: "Unknown", environment: "Unknown" },
  { sceneDescription: "未知", subject: "未知" },
])("rejects structurally complete but visually empty analysis", visual => {
  expect(() => validateSceneAnalysis({ story: { summary: "参考图片读取失败" }, visual, generationPrompt: "画面内容未知，请提供可以加载的参考图像。" })).toThrow("no usable visual evidence");
});
it("accepts observable content with locally unknown details and an empty audio track", () => {
  expect(() => validateSceneAnalysis({ story: { summary: "黑衣人物站在教室里" }, visual: { sceneDescription: "黑衣人物站在教室里，背景可见木桌", subject: "人物，身份未知", action: "无法确认" }, generationPrompt: "教室中景，黑衣人物站在木桌前。", audio: {} })).not.toThrow();
});
it("rejects explicit unavailable reference status even when other fields are filled", () => {
  expect(() => assertVisualEvidence({ visual: { sceneDescription: "empty" }, metadata: { referenceFilesStatus: "无法打开：a.jpg" } })).toThrow();
});
