import { z } from "zod";
import { readableVideoOverview } from "./video-overview";

export const scriptContentSchema = z.object({
  title: z.string().max(500), summary: z.string().max(20000),
  globalStyle: z.string().max(10000), characters: z.string().max(10000),
  continuityNotes: z.string().max(10000),
  scenes: z.array(z.object({
    id: z.string().uuid(), sceneIndex: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(),
    text: z.string().max(30000),
  }).strict()).max(100),
}).strict().refine(value => JSON.stringify(value).length <= 180000, "SCRIPT_TOO_LONG");
export type FullVideoScript = z.infer<typeof scriptContentSchema>;
export type ScriptRevision = { revision: number; content: FullVideoScript; savedAt: string };
export type ScriptCandidate = { requestId: string; fingerprint: string; sourceRevision: number; content: FullVideoScript; sceneIds: string[] };
export type ScriptDocument = ScriptRevision & { history: ScriptRevision[]; candidates: ScriptCandidate[]; pending?: { taskKey: string; until: number } };

type SourceScene = { id: string; sceneIndex: number; startTime: number; endTime: number };
type SourceVersion = {
  originalSceneId: string; sceneIndex: number; story: Record<string, unknown>; visual: Record<string, unknown>;
  audio: Record<string, unknown>; transition: Record<string, unknown>; generationPrompt: string;
  dialogue?: unknown[]; narration?: unknown[]; subtitle?: unknown[]; metadata?: Record<string, unknown>;
};
const readable = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.entries(value).map(([key, child]) => `${key}: ${readable(child)}`).filter(line => !line.endsWith(": ")).join("\n");
  return typeof value === "number" ? String(value) : "";
};

export function buildFullVideoScript(title: string, overview: Record<string, unknown>, scenes: SourceScene[], versions: SourceVersion[], zh: boolean): FullVideoScript {
  const result = readableVideoOverview(overview, versions);
  const label = (cn: string, en: string) => zh ? cn : en;
  return scriptContentSchema.parse({
    title, summary: result.paragraphs.join("\n\n"), globalStyle: result.style,
    characters: [...new Set(versions.filter(v => v.metadata?.analysisProvider !== "fallback").map(v => readable(v.visual.characters)).filter(Boolean))].join("\n\n"),
    continuityNotes: label("按原镜头时间点整理；内容来自已有 AI 分析，推断细节请对照原片核实。", "Compiled at the original scene boundaries from existing AI analysis. Verify inferred details against the source video."),
    scenes: [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex).map(scene => {
      const v = versions.find(version => version.originalSceneId === scene.id);
      const partial = !v || v.metadata?.analysisProvider === "fallback";
      const fields: [string, unknown][] = !v || partial ? [] : [
        [label("剧情", "Story"), v.story.summary || v.story.sceneDescription],
        [label("画面", "Visuals"), v.visual.sceneDescription || v.visual.subject],
        [label("角色", "Characters"), v.visual.characters], [label("环境", "Setting"), v.visual.environment],
        [label("动作", "Action"), v.visual.action || v.visual.motion], [label("运镜", "Camera"), v.visual.camera],
        [label("构图", "Composition"), v.visual.composition], [label("光影", "Lighting"), v.visual.lighting],
        [label("声音", "Audio"), v.audio], [label("对白", "Dialogue"), v.dialogue],
        [label("旁白", "Narration"), v.narration], [label("字幕", "Subtitles"), v.subtitle],
        [label("转场", "Transition"), v.transition], [label("复刻提示词", "Recreation prompt"), v.generationPrompt],
      ];
      return { id: scene.id, sceneIndex: scene.sceneIndex, startMs: Math.round(scene.startTime * 1000), endMs: Math.round(scene.endTime * 1000),
        text: partial ? label("此镜头分析未完成，暂无可靠脚本。", "Analysis is incomplete; no reliable script is available.")
          : fields.map(([name, value]) => { const text = readable(value); return text ? `${name}\n${text}` : ""; }).filter(Boolean).join("\n\n") };
    }),
  });
}

export function validateScriptBoundaries(source: FullVideoScript, target: FullVideoScript) {
  if (source.scenes.length !== target.scenes.length || source.scenes.some((s, i) => {
    const t = target.scenes[i];
    return s.id !== t.id || s.sceneIndex !== t.sceneIndex || s.startMs !== t.startMs || s.endMs !== t.endMs;
  })) throw new Error("SCRIPT_BOUNDARY_MISMATCH");
}

// Only explicitly selected scene text may cross the model boundary back into the document.
export function scopeScriptCandidate(source: FullVideoScript, candidate: FullVideoScript, sceneIds: string[]): FullVideoScript {
  validateScriptBoundaries(source, candidate);
  if (!sceneIds.length) return candidate;
  if (new Set(sceneIds).size !== sceneIds.length || sceneIds.some(id => !source.scenes.some(s => s.id === id))) throw new Error("SCRIPT_INVALID_SCOPE");
  return { ...source, scenes: source.scenes.map((s, i) => sceneIds.includes(s.id) ? { ...s, text: candidate.scenes[i].text } : s) };
}

export function scriptTime(ms: number) {
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${(ms % 60000 / 1000).toFixed(3).padStart(6, "0")}`;
}

export function exportFullVideoScript(content: FullVideoScript, format: "md" | "txt" | "json", projectId: string, projectVersionId: string, revision: number, zh: boolean) {
  if (format === "json") return JSON.stringify({ projectId, sourceProjectVersionId: projectVersionId, revision, ...content }, null, 2);
  const heading = (value: string, level = 2) => format === "md" ? `${"#".repeat(level)} ${value}` : value;
  const label = (cn: string, en: string) => zh ? cn : en;
  return [heading(content.title, 1), `${label("脚本修订", "Script revision")}: ${revision}`,
    content.summary, heading(label("全局风格", "Global style")), content.globalStyle,
    heading(label("角色", "Characters")), content.characters,
    ...content.scenes.flatMap(s => [heading(`${label("镜头", "Scene")} ${s.sceneIndex} · ${scriptTime(s.startMs)}–${scriptTime(s.endMs)}`), s.text]),
    heading(label("连续性与分析说明", "Continuity and analysis notes")), content.continuityNotes].filter(Boolean).join("\n\n") + "\n";
}
