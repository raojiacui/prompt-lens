import { getUserKieApiKey } from "@/lib/byok/kie";
import { routeModel } from "@/lib/ai/model-registry";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";

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
}

export interface SceneRewriteInput {
  userId: string;
  scene: SceneBlueprintDraft;
  instruction: string;
  duration?: number;
  sceneIndex?: number;
}

const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const KIE_ANALYSIS_MODEL = process.env.KIE_ANALYSIS_MODEL || routeModel({ category: "analysis", requiredCapabilities: ["text", "image"], priority: "balanced" })?.kieModelId || "gpt-5-2";
const KIE_ANALYSIS_ENDPOINT = process.env.KIE_ANALYSIS_ENDPOINT || `/${KIE_ANALYSIS_MODEL}/v1/chat/completions`;

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

function kieAnalysisUrl() {
  if (/^https?:\/\//i.test(KIE_ANALYSIS_ENDPOINT)) return KIE_ANALYSIS_ENDPOINT;
  return `${KIE_BASE_URL}${KIE_ANALYSIS_ENDPOINT.startsWith("/") ? KIE_ANALYSIS_ENDPOINT : `/${KIE_ANALYSIS_ENDPOINT}`}`;
}

async function callKieChatJson(params: {
  userId: string;
  system: string;
  content: Array<Record<string, unknown>>;
}) {
  const apiKey = await getKieApiKey(params.userId);
  if (!apiKey) return null;

  const response = await fetch(kieAnalysisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: KIE_ANALYSIS_MODEL,
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
  return parseJsonObject(content);
}

export function buildFallbackSceneBlueprint(scene: FfmpegSceneAsset, reason?: string): SceneBlueprintDraft {
  const label = `Scene ${String(scene.sceneIndex).padStart(2, "0")}`;
  const timeRange = `${scene.startTime.toFixed(1)}s-${scene.endTime.toFixed(1)}s`;
  return {
    story: {
      summary: `${label} covers ${timeRange} and should be reviewed against the extracted clip/keyframe before final generation.`,
      role: scene.sceneIndex === 1 ? "opening hook" : "continuation beat",
      beat: "Preserve the original timing and scene intent.",
    },
    visual: {
      subject: "Primary visible subject from the reference scene",
      environment: "Environment inferred from the extracted keyframe",
      action: "Main motion or action visible in this segment",
      camera: "Match framing, lens feel, movement, and composition from the reference clip",
      lighting: "Match the reference lighting direction, contrast, and exposure",
      color: "Match the dominant reference palette",
      style: "Reference-video style, realistic motion, coherent continuity",
    },
    dialogue: [],
    narration: [],
    subtitle: [],
    audio: {
      ambience: scene.audioUrl ? "Use extracted audio as timing reference." : "No scene audio extracted.",
      music: "Preserve the original rhythm unless the remix changes it.",
      sfx: [],
    },
    transition: {
      in: scene.transitionIn || (scene.sceneIndex === 1 ? "start" : "hard_cut"),
      out: scene.transitionOut || "hard_cut",
      rhythm: "Preserve original edit timing and scene duration.",
    },
    generationPrompt: `${label}: recreate the shot from ${timeRange}. Preserve scene duration (${scene.duration.toFixed(1)}s), subject motion, camera framing, lighting, color, pacing, and transition rhythm. Use the extracted keyframe and clip as references, then apply any user edits precisely.`,
    metadata: { analysisProvider: "fallback", fallbackReason: reason || "KIE analysis unavailable" },
  };
}

function normalizeBlueprint(raw: Record<string, unknown>, fallback: SceneBlueprintDraft, provider: string): SceneBlueprintDraft {
  return {
    story: { ...fallback.story, ...safeObject(raw.story) },
    visual: { ...fallback.visual, ...safeObject(raw.visual) },
    dialogue: safeArray(raw.dialogue),
    narration: safeArray(raw.narration),
    subtitle: safeArray(raw.subtitle),
    audio: { ...fallback.audio, ...safeObject(raw.audio) },
    transition: { ...fallback.transition, ...safeObject(raw.transition) },
    generationPrompt: text(raw.generationPrompt, fallback.generationPrompt),
    metadata: { ...safeObject(raw.metadata), analysisProvider: provider, analysisModel: KIE_ANALYSIS_MODEL, analyzedAt: new Date().toISOString() },
  };
}

export async function analyzeSceneBlueprint(params: {
  userId: string;
  scene: FfmpegSceneAsset;
  context: SceneContext;
}) {
  const fallback = buildFallbackSceneBlueprint(params.scene);
  try {
    const raw = await callKieChatJson({
      userId: params.userId,
      system: [
        "You are a senior AI video director. Return strict JSON only.",
        "Analyze one extracted reference-video scene and create a reusable Video Blueprint.",
        "Do not invent brand names or dialogue unless visible/audible evidence supports it.",
        "The JSON shape must include story, visual, dialogue, narration, subtitle, audio, transition, generationPrompt, metadata.",
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
            "Return concise but production-useful fields for story, visual, audio, and generationPrompt.",
          ].join("\n"),
        },
        ...params.scene.keyframeUrls.slice(0, 3).map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    });
    if (!raw) return buildFallbackSceneBlueprint(params.scene, "KIE API key not configured");
    return normalizeBlueprint(raw, fallback, "kie");
  } catch (error) {
    return buildFallbackSceneBlueprint(params.scene, error instanceof Error ? error.message : "KIE scene analysis failed");
  }
}

export async function buildStructuredVideoOverview(params: {
  userId: string;
  title?: string;
  sceneBlueprints: SceneBlueprintDraft[];
  remixPrompt?: string;
}) {
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
      system: "Return strict JSON only. Summarize the whole video blueprint for a creator dashboard.",
      content: [
        {
          type: "text",
          text: compactJson({ title: params.title, remixPrompt: params.remixPrompt, scenes: params.sceneBlueprints.map((scene) => ({ story: scene.story, visual: scene.visual, prompt: scene.generationPrompt })) }),
        },
      ],
    });
    if (!raw) return fallback;
    return { ...fallback, ...safeObject(raw) };
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
    return { ...normalizeBlueprint(raw, fallback, "kie"), metadata: { ...fallback.metadata, ...safeObject(raw.metadata), rewriteProvider: "kie", analysisModel: KIE_ANALYSIS_MODEL, rewrittenAt: new Date().toISOString() } };
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
}) {
  return rewriteSceneBlueprint({
    userId: params.userId,
    scene: params.scene,
    instruction: `Create a new remix version for this scene: ${params.remixPrompt}`,
    duration: params.duration,
    sceneIndex: params.sceneIndex,
  });
}
