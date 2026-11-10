import { assertInfistarModel, infistarJson, InfistarRequestError } from "./infistar-client";
import { readInfistarMedia } from "./infistar-media";
import type { TranscriptSegment, TranscriptionInput, TranscriptionResult } from "@/lib/workflow/transcription";

export const INFISTAR_TRANSCRIPTION_MODEL = "qwen-audio-3.0-asr-flash-filetrans";

export function infistarTranscriptSegments(payload: Record<string, unknown>): TranscriptSegment[] {
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
  const rows = data.segments || data.sentences || data.words;
  if (!Array.isArray(rows)) throw new InfistarRequestError("Infistar 未返回带时间戳的转写结果。", undefined, "confirmed_failure");
  return rows.map((row): TranscriptSegment => {
    const start = row.begin_time !== undefined ? Number(row.begin_time) / 1000 : Number(row.start);
    const end = row.end_time !== undefined ? Number(row.end_time) / 1000 : Number(row.end);
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !text) throw new InfistarRequestError("Infistar 转写时间戳无效。", undefined, "confirmed_failure");
    return { start, end, text, speaker: typeof row.speaker === "string" ? row.speaker : undefined };
  });
}

export async function transcribeInfistarMedia(input: TranscriptionInput): Promise<TranscriptionResult> {
  const model = input.modelMode === "manual" && input.modelId ? input.modelId : INFISTAR_TRANSCRIPTION_MODEL;
  if (!input.apiKey) throw new InfistarRequestError("请先配置 Infistar API Key。", undefined, "not_sent");
  await assertInfistarModel(input.apiKey, model);
  const media = await readInfistarMedia(input.mediaUrl, "audio");
  const form = new FormData();
  form.set("model", model); form.set("file", media, media.type.startsWith("video/") ? "source.mp4" : "source.wav");
  form.set("response_format", "verbose_json");
  const raw = await infistarJson("/audio/transcriptions", input.apiKey, form, input.timeoutMs ?? 180_000);
  return { provider: "infistar", modelId: model, status: "completed", segments: infistarTranscriptSegments(raw), raw };
}
