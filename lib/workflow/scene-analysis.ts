import { getUserKieApiKey } from "@/lib/byok/kie";
import { resolveModelSelection, type ModelPriority, type ModelSelectionMode } from "@/lib/ai/model-registry";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";
import type { SceneAudioContext } from "@/lib/workflow/transcription";

export interface SceneBlueprintDraft {
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  dialogue: unknown[];
  narration: unknown[];
  subtitle: unknown[];
  audio: Record<string, unknown>;
  transition: Record<string, unknown>;
  generationPrompt: string;
  metadata?: Record<string, unknown>;
}

export interface SceneContext {
  sceneCount: number;
  previousSummary?: string;
  nextSummary?: string;
  projectTitle?: string;
  audio?: SceneAudioContext;
}

export interface AiModelSelection {
  modelMode?: ModelSelectionMode;
  modelId?: string;
  modelPriority?: ModelPriority;
}

export interface SceneRewriteInput extends AiModelSelection {
  userId: string;
  scene: SceneBlueprintDraft;
  instruction: string;
  duration?: number;
  sceneIndex?: number;
}

type KieChatJsonResult = {
  json: Record<string, unknown>;
  modelId: string;
  modelMode: ModelSelectionMode;
  modelPriority: ModelPriority;
};

const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const DEFAULT_KIE_ANALYSIS_MODEL = process.env.KIE_ANALYSIS_MODEL;
const KIE_ANALYSIS_ENDPOINT = process.env.KIE_ANALYSIS_ENDPOINT;

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 5000);
  } catch {
    return String(value).slice(0, 5000);
  }
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error("KIE returned non-JSON scene analysis");
  }
}

async function getKieApiKey(userId: string) {
  if (process.env.NODE_ENV === "test" && !process.env.KIE_AI_API_KEY && !process.env.KIE_API_KEY) return null;
  return await getUserKieApiKey(userId) || process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || null;
}

function resolveAnalysisSelection(selection?: AiModelSelection) {
  const priority = selection?.modelPriority || "balanced";
  if (DEFAULT_KIE_ANALYSIS_MODEL && selection?.modelMode !== "manual") {
    return { modelId: DEFAULT_KIE_ANALYSIS_MODEL, modelMode: "auto" as const, modelPriority: priority };
  }

  const resolved = resolveModelSelection(
    "analysis",
    { mode: selection?.modelMode, modelId: selection?.modelId, priority },
    { requiredCapabilities: ["text", "image"] },
  );
  return { modelId: resolved.model.kieModelId, modelMode: resolved.mode, modelPriority: resolved.priority };
}

function kieAnalysisUrl(modelId: string) {
  const endpoint = KIE_ANALYSIS_ENDPOINT || `/${modelId}/v1/chat/completions`;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${KIE_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

async function callKieChatJson(params: {
  userId: string;
  system: string;
  content: Array<Record<string, unknown>>;
  selection?: AiModelSelection;
}): Promise<KieChatJsonResult | null> {
  const apiKey = await getKieApiKey(params.userId);
  if (!apiKey) return null;
  const selected = resolveAnalysisSelection(params.selection);

  const response = await fetch(kieAnalysisUrl(selected.modelId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selected.modelId,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.content },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.msg || `KIE analysis failed with ${response.status}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("KIE returned an empty scene analysis");
  return { json: parseJsonObject(content), ...selected };
}

export function buildFallbackSceneBlueprint(scene: FfmpegSceneAsset, reason?: string, audioContext?: SceneAudioContext): SceneBlueprintDraft {
  const label = `Scene ${String(scene.sceneIndex).padStart(2, "0")}`;
  const timeRange = `${scene.startTime.toFixed(1)}s-${scene.endTime.toFixed(1)}s`;
  return {
    story: {
      summary: `${label} covers ${timeRange} and should be reviewed against the extracted clip/keyframe before final generation.`,
      role: scene.sceneIndex === 1 ? "opening hook" : "continuation beat",
      beat: "Preserve the original timing and scene intent.",
    },
    visual: {
      sceneDescription: "Describe every visible element in the frame precisely enough for text-to-video recreation.",
      subject: "Primary visible subject from the reference scene",
      characters: "Characters, appearance, wardrobe, expression, pose, and relationship to each other",
      environment: "Location, background layers, props, time of day, weather, and set details inferred from the keyframe",
      action: "Main action, gesture sequence, object interaction, and motion direction visible in this segment",
      camera: "Shot size, lens feel, angle, height, movement path, motion speed, focus behavior, and framing",
      composition: "Subject placement, foreground/midground/background, negative space, symmetry, depth, and occlusion",
      lighting: "Light source, direction, softness, contrast, exposure, shadow shape, highlights, and time feeling",
      color: "Dominant palette, saturation, contrast, color temperature, skin/object tones, and grading style",
      style: "Reference-video style, realism level, texture, format, platform aesthetic, and production quality",
      motion: "Subject motion, camera motion, background motion, speed changes, and continuity constraints",
    },
    dialogue: audioContext?.dialogue || [],
    narration: [],
    subtitle: audioContext?.subtitle || [],
    audio: {
      ambience: scene.audioUrl ? "Use extracted audio as timing reference." : "No scene audio extracted.",
      music: "Preserve the original rhythm unless the remix changes it.",
      sfx: [],
      ...(audioContext?.audio || {}),
    },
    transition: {
      in: scene.transitionIn || (scene.sceneIndex === 1 ? "start" : "hard_cut"),
      out: scene.transitionOut || "hard_cut",
      rhythm: "Preserve original edit timing and scene duration.",
      editing: {
        pacing: "Describe cut speed, beat placement, and whether this is a fast cut, normal cut, or held shot.",
        techniques: ["hard_cut"],
        speedRamp: "unknown",
        splitScreen: "none",
        maskOrOverlay: "none",
        keyframes: "Describe visible zoom, pan, scale, opacity, or position keyframes if present.",
      },
    },
    generationPrompt: `${label}: visual-first text-to-video recreation prompt for ${timeRange}. Prioritize the exact visible image over music or editing guesses. Preserve duration (${scene.duration.toFixed(1)}s), subject identity, character appearance, wardrobe, expression, pose, environment, props, background layers, action sequence, shot size, camera angle, camera movement, composition, lighting direction, color palette, texture, realism level, and motion continuity. Mention audio or editing only as secondary constraints when they are evident. Describe the frame in concrete nouns and motion verbs so another AI video model can reproduce the reference shot without seeing the source video.`,
    metadata: { analysisProvider: "fallback", fallbackReason: reason || "KIE analysis unavailable", transcriptionProvider: audioContext?.audio.transcriptionProvider, transcriptionModel: audioContext?.audio.transcriptionModel, transcriptionTaskId: audioContext?.audio.transcriptionTaskId },
  };
}

function normalizeBlueprint(raw: Record<string, unknown>, fallback: SceneBlueprintDraft, provider: string): SceneBlueprintDraft {
  return {
    story: { ...fallback.story, ...safeObject(raw.story) },
    visual: { ...fallback.visual, ...safeObject(raw.visual) },
    dialogue: safeArray(raw.dialogue).length ? safeArray(raw.dialogue) : fallback.dialogue,
    narration: safeArray(raw.narration).length ? safeArray(raw.narration) : fallback.narration,
    subtitle: safeArray(raw.subtitle).length ? safeArray(raw.subtitle) : fallback.subtitle,
    audio: { ...fallback.audio, ...safeObject(raw.audio) },
    transition: { ...fallback.transition, ...safeObject(raw.transition) },
    generationPrompt: text(raw.generationPrompt, fallback.generationPrompt),
    metadata: { ...safeObject(raw.metadata), analysisProvider: provider, analyzedAt: new Date().toISOString() },
  };
}

export async function analyzeSceneBlueprint(params: {
  userId: string;
  scene: FfmpegSceneAsset;
  context: SceneContext;
} & AiModelSelection) {
  const fallback = buildFallbackSceneBlueprint(params.scene, undefined, params.context.audio);
  try {
    const raw = await callKieChatJson({
      userId: params.userId,
      selection: params,
      system: [
        "You are a senior AI video director and script breakdown specialist. Return strict JSON only.",
        "Analyze one extracted reference-video scene as a babysitter-level video script breakdown for near 1:1 text-to-video recreation.",
        "Primary goal: produce a visual-first recreation prompt. The prompt should let a text-to-video model reproduce the scene mostly from text alone. Audio and editing are secondary notes, not the center of the output.",
        "Be concrete and exhaustive about the visible image: objects, characters, wardrobe, expressions, pose, props, background layers, action order, camera language, lighting, color, composition, style, texture, and motion continuity.",
        "For music and editing, only describe observable or inferable style, rhythm, or basic techniques. Do not claim exact BGM title, software operations, masks, keyframes, or effects unless there is clear visual/audio evidence.",
        "Do not invent brand names or dialogue unless visible/audible evidence supports it. If something is uncertain, say unknown rather than hallucinating.",
        "The JSON shape must include story, visual, dialogue, narration, subtitle, audio, transition, generationPrompt, metadata. visual must include sceneDescription, subject, characters, environment, action, camera, composition, lighting, color, style, motion. transition must include editing.pacing and editing.techniques.",
        "generationPrompt must be a long, directly usable text-to-video prompt. Put visual reconstruction first; put dialogue/audio/editing constraints after the visual description and mark uncertain items as possible/unknown.",
      ].join(" "),
      content: [
        {
          type: "text",
          text: [
            `Scene index: ${params.scene.sceneIndex} of ${params.context.sceneCount}`,
            `Timing: ${params.scene.startTime}s to ${params.scene.endTime}s, duration ${params.scene.duration}s`,
            `Transition in/out: ${params.scene.transitionIn || "unknown"} / ${params.scene.transitionOut || "unknown"}`,
            `Previous summary: ${params.context.previousSummary || "none"}`,
            `Next summary: ${params.context.nextSummary || "none"}`,
            `Transcript/dialogue context from KIE speech-to-text: ${compactJson(params.context.audio || {})}`,
            "Output a detailed shot script with visual reconstruction as the highest priority. Include: 1) sceneDescription: exhaustive visible-frame reconstruction; 2) subject and characters: identity, appearance, wardrobe, expression, pose; 3) environment, props, background layers; 4) action sequence with temporal order; 5) camera: shot size, angle, lens feel, movement, focus, speed; 6) composition: foreground/midground/background, subject placement, depth; 7) lighting, color grading, texture, realism; 8) generationPrompt: a self-contained visual-first text-to-video prompt detailed enough to recreate roughly 90% of the scene without source media; 9) audio: transcript/dialogue and broad sound style only; 10) editing: basic transition/rhythm notes with confidence, avoid overclaiming. Preserve transcript timing when present.",
          ].join("\n"),
        },
        ...params.scene.keyframeUrls.slice(0, 3).map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    });
    if (!raw) return buildFallbackSceneBlueprint(params.scene, "KIE API key not configured", params.context.audio);
    const blueprint = normalizeBlueprint(raw.json, fallback, "kie");
    return { ...blueprint, metadata: { ...(blueprint.metadata || {}), analysisModel: raw.modelId, modelMode: raw.modelMode, modelPriority: raw.modelPriority } };
  } catch (error) {
    return buildFallbackSceneBlueprint(params.scene, error instanceof Error ? error.message : "KIE scene analysis failed", params.context.audio);
  }
}

export async function buildStructuredVideoOverview(params: {
  userId: string;
  title?: string;
  sceneBlueprints: SceneBlueprintDraft[];
  remixPrompt?: string;
} & AiModelSelection) {
  const fallback = {
    theme: params.remixPrompt ? "Reference-driven remix" : "Reference-driven AI video workflow",
    narrative: `The video is prepared as ${params.sceneBlueprints.length} editable scene blueprint units.`,
    hook: text(params.sceneBlueprints[0]?.story?.summary, "Use the first scene as the opening hook."),
    editingRhythm: "Follow detected scene boundaries and preserve timing during remix/generation.",
    audioStyle: "Use extracted audio cues when available and keep scene-level rhythm aligned.",
    remixDirection: params.remixPrompt || undefined,
    whyThisWorks: "Scene-level structure lets users remix and generate without copy/paste between tools.",
  };

  try {
    const raw = await callKieChatJson({
      userId: params.userId,
      selection: params,
      system: "Return strict JSON only. Summarize the whole video blueprint for a creator dashboard.",
      content: [
        {
          type: "text",
          text: compactJson({ title: params.title, remixPrompt: params.remixPrompt, scenes: params.sceneBlueprints.map((scene) => ({ story: scene.story, visual: scene.visual, audio: scene.audio, transition: scene.transition, dialogue: scene.dialogue, subtitle: scene.subtitle, prompt: scene.generationPrompt })) }),
        },
      ],
    });
    if (!raw) return fallback;
    return { ...fallback, ...safeObject(raw.json), metadata: { analysisModel: raw.modelId, modelMode: raw.modelMode, modelPriority: raw.modelPriority } };
  } catch {
    return fallback;
  }
}

export async function rewriteSceneBlueprint(params: SceneRewriteInput): Promise<SceneBlueprintDraft> {
  const fallback: SceneBlueprintDraft = {
    story: { ...safeObject(params.scene.story), rewriteInstruction: params.instruction },
    visual: params.scene.visual,
    dialogue: params.scene.dialogue,
    narration: params.scene.narration,
    subtitle: params.scene.subtitle,
    audio: params.scene.audio,
    transition: params.scene.transition,
    generationPrompt: `${params.scene.generationPrompt}\n\nScene rewrite instruction: ${params.instruction}. Preserve duration${params.duration ? ` (${params.duration.toFixed(1)}s)` : ""}, scene index, edit rhythm, and continuity with adjacent scenes.`,
    metadata: { ...params.scene.metadata, rewriteProvider: "fallback", rewriteInstruction: params.instruction },
  };

  try {
    const raw = await callKieChatJson({
      userId: params.userId,
      selection: params,
      system: [
        "You are rewriting one scene blueprint for AI video generation. Return strict JSON only.",
        "Preserve the same schema: story, visual, dialogue, narration, subtitle, audio, transition, generationPrompt, metadata.",
        "Apply the user's instruction while keeping duration, pacing, and shot continuity coherent.",
      ].join(" "),
      content: [
        {
          type: "text",
          text: compactJson({ sceneIndex: params.sceneIndex, duration: params.duration, instruction: params.instruction, currentScene: params.scene }),
        },
      ],
    });
    if (!raw) return fallback;
    const blueprint = normalizeBlueprint(raw.json, fallback, "kie");
    return { ...blueprint, metadata: { ...fallback.metadata, ...(blueprint.metadata || {}), rewriteProvider: "kie", analysisModel: raw.modelId, modelMode: raw.modelMode, modelPriority: raw.modelPriority, rewrittenAt: new Date().toISOString() } };
  } catch {
    return fallback;
  }
}

export async function remixSceneBlueprint(params: {
  userId: string;
  scene: SceneBlueprintDraft;
  remixPrompt: string;
  sceneIndex: number;
  duration: number;
} & AiModelSelection) {
  return rewriteSceneBlueprint({
    userId: params.userId,
    scene: params.scene,
    instruction: `Create a new remix version for this scene: ${params.remixPrompt}`,
    duration: params.duration,
    sceneIndex: params.sceneIndex,
    modelMode: params.modelMode,
    modelId: params.modelId,
    modelPriority: params.modelPriority,
  });
}