import { resolveModelSelection, type ModelPriority, type ModelSelectionMode } from "@/lib/ai/model-registry";
import type { SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";

export interface AudioModelSelection {
  modelMode?: ModelSelectionMode;
  modelId?: string;
  modelPriority?: ModelPriority;
}

export interface TimedText {
  start?: number;
  end?: number;
  speaker?: string;
  text?: string;
  role?: string;
}

export interface AudioProductionScene {
  id: string;
  sceneIndex: number;
  duration: number;
  blueprint: Pick<SceneBlueprintDraft, "dialogue" | "narration" | "subtitle" | "audio" | "generationPrompt">;
}

export interface AudioCue {
  id: string;
  sceneId: string;
  sceneIndex: number;
  kind: "dialogue" | "narration";
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export interface SubtitleCue {
  index: number;
  sceneId: string;
  sceneIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface AudioProductionPlan {
  modelId: string;
  modelMode: ModelSelectionMode;
  modelPriority: ModelPriority;
  cues: AudioCue[];
  subtitles: SubtitleCue[];
  srt: string;
  bgm: { prompt: string; level: number };
  sfx: Array<{ sceneId: string; sceneIndex: number; prompt: string; at: number }>;
}

function asTimedTextArray(value: unknown): TimedText[] {
  return Array.isArray(value)
    ? value.filter((item): item is TimedText => typeof item === "object" && item !== null)
    : [];
}

function textFrom(value: TimedText) {
  return String(value.text || value.role || "").trim();
}

function clampTime(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

export function formatSrtTimestamp(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(subtitles: SubtitleCue[]) {
  return subtitles
    .map((cue, index) => [String(index + 1), `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`, cue.text].join("\n"))
    .join("\n\n");
}

function cueFromTimedText(params: { item: TimedText; scene: AudioProductionScene; kind: "dialogue" | "narration"; index: number }): AudioCue | null {
  const text = textFrom(params.item);
  if (!text) return null;
  const start = clampTime(params.item.start, 0);
  const end = Math.max(start + 0.8, clampTime(params.item.end, Math.min(params.scene.duration, start + 2.4)));
  return {
    id: `${params.scene.id}-${params.kind}-${params.index}`,
    sceneId: params.scene.id,
    sceneIndex: params.scene.sceneIndex,
    kind: params.kind,
    start,
    end,
    text,
    speaker: params.item.speaker || (params.kind === "narration" ? "Narrator" : "Speaker"),
  };
}

function subtitleFromCue(cue: AudioCue, index: number): SubtitleCue {
  return { index, sceneId: cue.sceneId, sceneIndex: cue.sceneIndex, start: cue.start, end: cue.end, text: cue.text };
}

function fallbackCue(scene: AudioProductionScene): AudioCue {
  return {
    id: `${scene.id}-narration-fallback`,
    sceneId: scene.id,
    sceneIndex: scene.sceneIndex,
    kind: "narration",
    start: 0,
    end: Math.max(1.2, Math.min(scene.duration, 4)),
    text: scene.blueprint.generationPrompt || `Narration for scene ${scene.sceneIndex}`,
    speaker: "Narrator",
  };
}

export function buildAudioProductionPlan(scenes: AudioProductionScene[], selection?: AudioModelSelection): AudioProductionPlan {
  const resolved = resolveModelSelection(
    "audio",
    { mode: selection?.modelMode, modelId: selection?.modelId, priority: selection?.modelPriority || "balanced" },
    { requiredCapabilities: ["tts"] },
  );

  const cues = scenes.flatMap((scene) => {
    const dialogue = asTimedTextArray(scene.blueprint.dialogue)
      .map((item, index) => cueFromTimedText({ item, scene, kind: "dialogue", index }))
      .filter((cue): cue is AudioCue => Boolean(cue));
    const narration = asTimedTextArray(scene.blueprint.narration)
      .map((item, index) => cueFromTimedText({ item, scene, kind: "narration", index }))
      .filter((cue): cue is AudioCue => Boolean(cue));
    const combined = [...dialogue, ...narration];
    return combined.length ? combined : [fallbackCue(scene)];
  });

  const subtitlesFromBlueprint = scenes.flatMap((scene) =>
    asTimedTextArray(scene.blueprint.subtitle)
      .map((item, index) => cueFromTimedText({ item, scene, kind: "dialogue", index }))
      .filter((cue): cue is AudioCue => Boolean(cue)),
  );
  const subtitleSource = subtitlesFromBlueprint.length ? subtitlesFromBlueprint : cues;
  const subtitles = subtitleSource
    .sort((a, b) => a.sceneIndex - b.sceneIndex || a.start - b.start)
    .map((cue, index) => subtitleFromCue(cue, index + 1));

  const audioSummaries = scenes
    .map((scene) => {
      const audioValue = scene.blueprint.audio as Record<string, unknown>;
      return String(audioValue.music || audioValue.ambience || audioValue.summary || "").trim();
    })
    .filter(Boolean);

  const sfx = scenes.flatMap((scene) => {
    const audioValue = scene.blueprint.audio as Record<string, unknown>;
    const raw = Array.isArray(audioValue.sfx) ? audioValue.sfx : [];
    return raw
      .map((item, index) => {
        if (typeof item === "string") return { sceneId: scene.id, sceneIndex: scene.sceneIndex, prompt: item, at: 0 };
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          return {
            sceneId: scene.id,
            sceneIndex: scene.sceneIndex,
            prompt: String(record.prompt || record.type || record.text || `SFX ${index + 1}`),
            at: clampTime(record.at ?? record.start, 0),
          };
        }
        return null;
      })
      .filter((item): item is { sceneId: string; sceneIndex: number; prompt: string; at: number } => Boolean(item));
  });

  return {
    modelId: resolved.model.kieModelId,
    modelMode: resolved.mode,
    modelPriority: resolved.priority,
    cues,
    subtitles,
    srt: buildSrt(subtitles),
    bgm: {
      prompt: audioSummaries.length ? audioSummaries.join("; ") : "Subtle background music that supports the scene rhythm without overpowering dialogue.",
      level: 0.35,
    },
    sfx,
  };
}