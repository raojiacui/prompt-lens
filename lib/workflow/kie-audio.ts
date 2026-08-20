import type { AudioCue } from "@/lib/workflow/audio-production";

export interface KieDialogueTaskInput {
  apiKey: string;
  modelId: string;
  cues: AudioCue[];
  callBackUrl?: string;
}

export interface KieDialogueTaskResult {
  taskId: string;
  recordId?: string;
  raw: unknown;
}

const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const DEFAULT_VOICES = ["EkK5I93UQWFDigLMpZcX", "Z3R5wn05IrDiVCyEkUrK", "NNl6r8mD7vthiJatiJt1", "21m00Tcm4TlvDq8ikWAM"];

function voiceForCue(cue: AudioCue, index: number) {
  const speakerVoiceEnvKey = `KIE_ELEVENLABS_VOICE_${cue.speaker.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return process.env[speakerVoiceEnvKey] || process.env.KIE_ELEVENLABS_DEFAULT_VOICE_ID || DEFAULT_VOICES[index % DEFAULT_VOICES.length];
}

function assertKieTaskPayload(payload: unknown, fallbackMessage: string): KieDialogueTaskResult {
  if (typeof payload !== "object" || payload === null) throw new Error(fallbackMessage);
  const record = payload as Record<string, unknown>;
  if ("code" in record && record.code !== 200) {
    throw new Error(`kie.ai error ${record.code}: ${String(record.msg || record.message || fallbackMessage)}`);
  }
  const data = typeof record.data === "object" && record.data !== null ? record.data as Record<string, unknown> : record;
  const taskId = typeof data.taskId === "string" ? data.taskId : "";
  if (!taskId) throw new Error("KIE audio response did not include taskId");
  return {
    taskId,
    recordId: typeof data.recordId === "string" ? data.recordId : undefined,
    raw: payload,
  };
}

export async function createKieDialogueTask(input: KieDialogueTaskInput): Promise<KieDialogueTaskResult> {
  const dialogue = input.cues
    .filter((cue) => cue.text.trim())
    .slice(0, 50)
    .map((cue, index) => ({
      text: cue.text.trim(),
      voice: voiceForCue(cue, index),
    }));

  if (!dialogue.length) throw new Error("No dialogue or narration cues available for KIE audio generation");

  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.modelId,
      ...(input.callBackUrl ? { callBackUrl: input.callBackUrl } : {}),
      input: {
        dialogue,
        stability: 0.5,
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`kie.ai audio request failed: ${response.status}`);
  return assertKieTaskPayload(payload, "KIE audio request failed");
}