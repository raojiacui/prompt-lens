export class InvalidSceneAnalysisResult extends Error {
  attempts = 1;
  constructor(message: string) { super(message); this.name = "InvalidSceneAnalysisResult"; }
}

export function hasUsablePrompt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const content = value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  if (!/\p{L}/u.test(content)) return false;
  const plain = content.replace(/^[\s`*_#\[\]【】]+|[\s`*_#\[\]【】:：.。]+$/g, "");
  return !/^(?:json|null|undefined|none|n\/?a|unknown|empty|pending|tbd|prompt|generation[_ ]?prompt|待补充|暂无|无|无结果|未生成|分析失败|提示词|核心提示词)$/i.test(plain);
}

function hasText(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === "string") return hasUsablePrompt(value);
  if (Array.isArray(value)) return value.some(item => hasText(item, depth + 1));
  return Boolean(value && typeof value === "object" && Object.values(value).some(item => hasText(item, depth + 1)));
}

export function validateSceneAnalysis(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidSceneAnalysisResult("KIE returned non-object scene analysis");
  const raw = value as Record<string, unknown>;
  assertVisualEvidence(raw);
  const invalid = [
    !hasUsablePrompt(raw.generationPrompt) ? "generationPrompt" : null,
    !raw.visual || typeof raw.visual !== "object" || Array.isArray(raw.visual) || !hasText(raw.visual) ? "visual" : null,
    !(typeof raw.story === "string" || (raw.story && typeof raw.story === "object" && !Array.isArray(raw.story))) || !hasText(raw.story) ? "story" : null,
  ].filter(Boolean);
  if (invalid.length) throw new InvalidSceneAnalysisResult(`KIE returned an incomplete scene analysis: invalid fields ${invalid.join(", ")}`);
}

export function assertVisualEvidence(raw: Record<string, unknown>) {
  const visual = raw.visual && typeof raw.visual === "object" ? raw.visual as Record<string, unknown> : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata as Record<string, unknown> : {};
  const evidence = [visual.sceneDescription, visual.subject, visual.environment, visual.action].filter((v): v is string => typeof v === "string");
  const failure = /(?:无法|未能|不能|未成功).{0,12}(?:加载|读取|打开|访问|查看|观察|识别)|(?:图片|图像|画面|参考帧).{0,12}(?:不可用|读取失败|加载失败|缺失)|(?:cannot|could not|unable to|failed to).{0,25}(?:load|read|open|access|view|see).{0,25}(?:image|frame|visual)|(?:image|frame).{0,25}(?:unavailable|inaccessible|failed to load|could not be loaded|cannot be (?:read|opened|accessed))/i;
  const missing = /^(?:未知|无法判断|无法确认|不确定|unknown|unavailable|not visible|cannot determine)(?:[\s，。,.：:]|$)/i;
  if (failure.test(String(metadata.referenceFilesStatus || "")) || evidence.length > 0 && evidence.every(text => missing.test(text) || failure.test(text))) {
    throw new InvalidSceneAnalysisResult("Analysis contains no usable visual evidence: reference images could not be read");
  }
}
