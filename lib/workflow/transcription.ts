import { resolveModelSelection, type ModelPriority, type ModelSelectionMode } from "@/lib/ai/model-registry";
import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface SceneAudioContext {
  dialogue: TranscriptSegment[];
  subtitle: Array<{ start: number; end: number; text: string; speaker?: string }>;
  audio: {
    transcriptSummary: string;
    hasSpeech: boolean;
    transcriptionProvider: "kie" | "unavailable";
    transcriptionModel?: string;
    transcriptionTaskId?: string;
    transcriptionReason?: string;
  };
}

export interface KieTranscriptionInput {
  userId: string;
  apiKey: string | null;
  mediaUrl: string;
  modelMode?: ModelSelectionMode;
  modelId?: string;
  modelPriority?: ModelPriority;
  poll?: boolean;
  timeoutMs?: number;
}

export interface KieTranscriptionResult {
  provider: "kie";
  modelId: string;
  taskId?: string;
  recordId?: string;
  status: "completed" | "submitted";
  segments: TranscriptSegment[];
  raw?: unknown;
}

const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

async function ensureAccessibleUrl(url: string) {
  const key = extractR2Key(url);
  if (!key) return url;
  try {
    return await getSignedUrlFromR2(key, 7200);
  } catch {
    return url;
  }
}

function numberFrom(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function textFrom(record: Record<string, unknown>) {
  return String(record.text || record.word || record.transcript || record.sentence || "").trim();
}

function secondsFrom(value: unknown) {
  const next = numberFrom(value, 0);
  return next > 1000 ? next / 1000 : next;
}

function normalizeSegment(value: unknown): TranscriptSegment | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = textFrom(record);
  if (!text) return null;
  const start = secondsFrom(record.start ?? record.startTime ?? record.begin ?? record.start_ms);
  const end = Math.max(start + 0.2, secondsFrom(record.end ?? record.endTime ?? record.finish ?? record.end_ms ?? start + 1));
  return {
    start,
    end,
    text,
    speaker: typeof record.speaker === "string" ? record.speaker : typeof record.speaker_id === "string" ? record.speaker_id : undefined,
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
  };
}

function collectSegments(value: unknown): TranscriptSegment[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeSegment).filter((item): item is TranscriptSegment => Boolean(item));
  if (typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidates = [record.segments, record.words, record.sentences, record.transcription, record.transcript, record.results];
  for (const candidate of candidates) {
    const segments = collectSegments(candidate);
    if (segments.length) return segments;
  }
  return [];
}

function extractTaskIds(payload: unknown) {
  const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const data = typeof record.data === "object" && record.data !== null ? record.data as Record<string, unknown> : record;
  return {
    taskId: typeof data.taskId === "string" ? data.taskId : typeof data.task_id === "string" ? data.task_id : undefined,
    recordId: typeof data.recordId === "string" ? data.recordId : typeof data.record_id === "string" ? data.record_id : undefined,
  };
}

function statusFrom(payload: unknown) {
  const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const data = typeof record.data === "object" && record.data !== null ? record.data as Record<string, unknown> : record;
  return String(data.state || data.status || record.state || record.status || "").toLowerCase();
}

async function fetchKieTask(apiKey: string, taskId: string) {
  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`KIE transcription status failed: ${response.status}`);
  return payload;
}

export async function transcribeMediaWithKie(input: KieTranscriptionInput): Promise<KieTranscriptionResult | null> {
  if (!input.apiKey) return null;
  const selected = resolveModelSelection(
    "audio",
    { mode: input.modelMode, modelId: input.modelId, priority: input.modelPriority || "balanced" },
    { requiredCapabilities: ["transcription"] },
  );
  const mediaUrl = await ensureAccessibleUrl(input.mediaUrl);
  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selected.model.kieModelId,
      input: {
        audio_url: mediaUrl,
        video_url: mediaUrl,
        speaker_labels: true,
        timestamps: true,
      },
    }),
  });

  const createPayload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`KIE transcription request failed: ${response.status}`);
  const { taskId, recordId } = extractTaskIds(createPayload);
  if (!taskId) throw new Error("KIE transcription response did not include taskId");

  if (input.poll === false) {
    return { provider: "kie", modelId: selected.model.kieModelId, taskId, recordId, status: "submitted", segments: [], raw: createPayload };
  }

  const deadline = Date.now() + (input.timeoutMs || DEFAULT_TIMEOUT_MS);
  let latest: unknown = createPayload;
  while (Date.now() < deadline) {
    latest = await fetchKieTask(input.apiKey, taskId);
    const status = statusFrom(latest);
    const segments = collectSegments(latest).sort((a, b) => a.start - b.start);
    if (segments.length || status === "success" || status === "completed") {
      return { provider: "kie", modelId: selected.model.kieModelId, taskId, recordId, status: "completed", segments, raw: latest };
    }
    if (status === "fail" || status === "failed" || status === "error") throw new Error("KIE transcription failed");
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  throw new Error("KIE transcription timed out");
}

function overlaps(segment: TranscriptSegment, scene: FfmpegSceneAsset) {
  return segment.end > scene.startTime && segment.start < scene.endTime;
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clampToScene(segment: TranscriptSegment, scene: FfmpegSceneAsset): TranscriptSegment {
  return {
    ...segment,
    start: roundTime(Math.max(0, segment.start - scene.startTime)),
    end: roundTime(Math.max(0.2, Math.min(scene.endTime, segment.end) - scene.startTime)),
  };
}

export function buildSceneAudioContexts(params: {
  scenes: FfmpegSceneAsset[];
  transcription: KieTranscriptionResult | null;
  unavailableReason?: string;
}): Map<number, SceneAudioContext> {
  const contexts = new Map<number, SceneAudioContext>();
  for (const scene of params.scenes) {
    const dialogue = params.transcription
      ? params.transcription.segments.filter((segment) => overlaps(segment, scene)).map((segment) => clampToScene(segment, scene))
      : [];
    const transcriptSummary = dialogue.map((item) => `${item.speaker ? `${item.speaker}: ` : ""}${item.text}`).join(" ").trim();
    contexts.set(scene.sceneIndex, {
      dialogue,
      subtitle: dialogue.map((item) => ({ start: item.start, end: item.end, text: item.text, speaker: item.speaker })),
      audio: {
        transcriptSummary,
        hasSpeech: dialogue.length > 0,
        transcriptionProvider: params.transcription ? "kie" : "unavailable",
        transcriptionModel: params.transcription?.modelId,
        transcriptionTaskId: params.transcription?.taskId,
        transcriptionReason: params.transcription ? undefined : params.unavailableReason || "KIE transcription was not available",
      },
    });
  }
  return contexts;
}
