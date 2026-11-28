import { expect, it } from "vitest";
import { parseSceneAnalysisJson } from "@/lib/workflow/scene-analysis-json";
const good = { story: { summary: "黑衣人物站在教室里" }, visual: { subject: "黑衣长发人物", sceneDescription: "木桌前的黑衣人物，背景是学生" }, generationPrompt: "黑衣人物站在木桌前，背景学生书写。" };
const bad = { story: { summary: "参考图像无法打开" }, visual: { subject: "未知", sceneDescription: "参考图像未能成功打开，内容不可见" }, generationPrompt: "请提供图片，当前参考图像无法读取。" };
it.each(["", "```json\n"])("recovers a valid correction after an unreadable draft (%s)", fence => {
  const block = (x: unknown) => fence + JSON.stringify(x) + (fence ? "\n```" : "");
  expect(parseSceneAnalysisJson(block(bad) + block(good))).toEqual(good);
});
it("preserves braces, quotes and escapes inside text", () => {
  const value = { ...good, generationPrompt: '黑衣人物手持写着 {"a":"b"} 的纸张。\\' };
  expect(parseSceneAnalysisJson(JSON.stringify(value))).toEqual(value);
});
it("accepts one fenced document and repeated identical results", () => {
  expect(parseSceneAnalysisJson("```json\n" + JSON.stringify(good) + "\n```")).toEqual(good);
  expect(parseSceneAnalysisJson(JSON.stringify(good).repeat(2))).toEqual(good);
});
it.each([JSON.stringify(bad), '{"visual":', JSON.stringify(good) + '{"visual":', JSON.stringify(good) + JSON.stringify({ ...good, generationPrompt: "另一个场景" })])("rejects invalid, truncated or conflicting answers", raw => {
  expect(() => parseSceneAnalysisJson(raw)).toThrow();
});
