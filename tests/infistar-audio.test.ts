import { afterEach, expect, it, vi } from "vitest";
import { infistarTranscriptSegments, transcribeInfistarMedia } from "@/lib/ai/infistar-audio";
vi.mock("@/lib/ai/infistar-media", () => ({ readInfistarMedia: vi.fn(async () => new Blob(["synthetic-audio"], { type: "audio/wav" })) }));
afterEach(() => vi.unstubAllGlobals());
it("preserves real timestamps instead of fabricating subtitle timing", () => {
  expect(infistarTranscriptSegments({ sentences: [{ begin_time: 200, end_time: 800, text: "你好" }] })).toEqual([{ start: 0.2, end: 0.8, text: "你好", speaker: undefined }]);
  expect(() => infistarTranscriptSegments({ text: "no timestamps" })).toThrow("时间戳");
});
it("rejects reversed timestamps", () => {
  expect(() => infistarTranscriptSegments({ segments: [{ start: 2, end: 1, text: "hello" }] })).toThrow("无效");
});
it("routes audio files only to the available Infistar transcription endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "qwen-audio-3.0-asr-flash-filetrans" }] }))
    .mockResolvedValueOnce(Response.json({ segments: [{ start: 0, end: 1, text: "hello" }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await transcribeInfistarMedia({ userId: "owner", apiKey: "audio-provider-fixture", mediaUrl: "https://media.example/source.wav", provider: "infistar" })).toMatchObject({ provider: "infistar", segments: [{ start: 0, end: 1, text: "hello" }] });
  expect(fetcher.mock.calls[1][0]).toBe("https://infistar.cc/v1/audio/transcriptions");
  expect(fetcher.mock.calls[1][1].body.get("file")).toBeInstanceOf(Blob);
});
