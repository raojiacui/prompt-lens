import { resolveModelSelection, type ModelPriority, type ModelSelectionMode } from "@/lib/ai/model-registry";

export type EditMode = "standard" | "generative";

export interface EditModelSelection {
  modelMode?: ModelSelectionMode;
  modelId?: string;
  modelPriority?: ModelPriority;
}

export type EditOperation =
  | { type: "trim"; sceneId?: string; start?: number; end?: number; endOffset?: number }
  | { type: "delete"; sceneId?: string; sceneIndex?: number }
  | { type: "volume"; track: "voice" | "bgm" | "sfx" | "master"; value: number }
  | { type: "subtitle_style"; size?: "small" | "medium" | "large"; position?: "bottom" | "center" | "top" }
  | { type: "concat"; segments: Array<{ start: number; end: number }> };

export interface EditPlan {
  mode: EditMode;
  operations: EditOperation[];
  notes: string[];
  modelId?: string;
  modelMode?: ModelSelectionMode;
  modelPriority?: ModelPriority;
  prompt: string;
}

function parseSceneIndex(prompt: string) {
  const direct = prompt.match(/scene\s*0?(\d+)/i);
  if (direct) return Number.parseInt(direct[1], 10);
  const cn = prompt.match(/第\s*([一二三四五六七八九十\d]+)\s*(个|段|镜头|场景|scene)/i);
  if (!cn) return undefined;
  const value = cn[1];
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[value];
}

function parseRange(prompt: string): { start: number; end: number } | null {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(?:-|到|~)\s*(\d+(?:\.\d+)?)\s*秒/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function parseVolume(prompt: string): EditOperation | null {
  if (!/(音量|volume|bgm|music|voice|声音|旁白|人声)/i.test(prompt)) return null;
  const track: "voice" | "bgm" | "sfx" | "master" = /(bgm|music|背景音乐|音乐)/i.test(prompt)
    ? "bgm"
    : /(sfx|音效)/i.test(prompt)
      ? "sfx"
      : /(voice|人声|旁白|台词)/i.test(prompt)
        ? "voice"
        : "master";
  const explicitLevel = prompt.match(/(0?\.\d+|[1-9]\d?%)/);
  const raw = explicitLevel ? explicitLevel[1] : "";
  const value = raw
    ? raw.endsWith("%")
      ? Number.parseInt(raw, 10) / 100
      : Number(raw)
    : /小|降低|lower|down/i.test(prompt)
      ? 0.45
      : 0.75;
  return { type: "volume", track, value: Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.75)) };
}

function wantsGenerativeEdit(prompt: string) {
  return /(换成|替换|replace|change.*(person|subject|background)|背景换|风格|style|保留动作|video-to-video|生成式|generative)/i.test(prompt);
}

export function buildEditPlan(params: {
  prompt: string;
  mode?: EditMode | "auto";
  sourceVideoUrl?: string;
  sceneIdsByIndex?: Record<number, string>;
} & EditModelSelection): EditPlan {
  const prompt = params.prompt.trim();
  const mode: EditMode = params.mode === "generative" || (params.mode !== "standard" && wantsGenerativeEdit(prompt)) ? "generative" : "standard";

  if (mode === "generative") {
    const resolved = resolveModelSelection(
      "video_edit",
      { mode: params.modelMode, modelId: params.modelId, priority: params.modelPriority || "balanced" },
      { requiredCapabilities: ["video_to_video", "generative_edit"] },
    );
    return {
      mode,
      operations: [],
      notes: ["Generative edit will submit the source video and prompt to a KIE video edit model."],
      modelId: resolved.model.kieModelId,
      modelMode: resolved.mode,
      modelPriority: resolved.priority,
      prompt,
    };
  }

  const operations: EditOperation[] = [];
  const sceneIndex = parseSceneIndex(prompt);
  const sceneId = sceneIndex ? params.sceneIdsByIndex?.[sceneIndex] : undefined;
  const range = parseRange(prompt);
  const volume = parseVolume(prompt);

  if (/(删除|删掉|remove|delete)/i.test(prompt)) operations.push({ type: "delete", sceneIndex, sceneId });
  if (/(短一点|shorter|trim|裁剪|剪短)/i.test(prompt)) operations.push({ type: "trim", sceneId, endOffset: -1 });
  if (range) operations.push({ type: "concat", segments: [range] });
  if (volume) operations.push(volume);
  if (/(字幕|subtitle)/i.test(prompt) && /(大|large|bigger|大一点)/i.test(prompt)) operations.push({ type: "subtitle_style", size: "large", position: "bottom" });

  return {
    mode,
    operations: operations.length ? operations : [{ type: "trim", start: 0 }],
    notes: operations.length ? [] : ["No precise operation was detected; preserve source timing unless the user refines the request."],
    prompt,
  };
}