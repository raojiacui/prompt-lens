import assert from "node:assert/strict";
import { test } from "vitest";
import { inspectVideoProbe, detectWithFallback, ingestVideoCandidates } from "../workers/ffmpeg-worker/video-inspection.mjs";

const video = (index = 0, extra = {}) => ({ index, codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1", ...extra });
const probe = (...streams) => ({ format: { duration: "12.734" }, streams });
const unsupported = () => Object.assign(new Error("unknown codec bvc2"), { code: "UNSUPPORTED_VIDEO_CODEC" });

test("rejects bvc2 dimensions without a recognized codec before creating a preview", async () => {
  let decoded = false;
  await assert.rejects(inspectVideoProbe(probe(video(0, { codec_name: undefined, codec_tag_string: "bvc2" })), async () => { decoded = true; }), { code: "UNSUPPORTED_VIDEO_CODEC", statusCode: 422 });
  assert.equal(decoded, false);
});

test("skips attached pictures and unsupported video streams when a normal stream exists", async () => {
  const selected = [];
  const metadata = await inspectVideoProbe(probe(
    video(0, { disposition: { attached_pic: 1 } }),
    video(1, { codec_name: "unknown" }),
    video(2),
    { index: 3, codec_type: "audio", codec_name: "aac" },
  ), async index => { selected.push(index); });
  assert.deepEqual(selected, [2]);
  assert.equal(metadata.videoStreamIndex, 2);
  assert.equal(metadata.useFfmpegSceneDetection, true);
  assert.equal(metadata.duration, 12.734);
  assert.equal(metadata.hasAudio, true);
  assert.equal(metadata.fps, 30);
});

test("requires actual decoding and tries the next normal video stream after decoder failure", async () => {
  const selected = [];
  const metadata = await inspectVideoProbe(probe(video(0), video(1)), async index => {
    selected.push(index);
    if (index === 0) throw new Error("decoder not found");
  });
  assert.deepEqual(selected, [0, 1]);
  assert.equal(metadata.videoStreamIndex, 1);
  assert.equal(metadata.useFfmpegSceneDetection, true);
  await assert.rejects(inspectVideoProbe(probe(video()), async () => { throw new Error("corrupt frame"); }), { code: "INVALID_VIDEO_STREAM", statusCode: 422 });
});

test("uses explicitly mapped detection when attached artwork precedes the video", async () => {
  const metadata = await inspectVideoProbe(probe(video(0, { disposition: { attached_pic: 1 } }), video(1)), async () => {});
  assert.equal(metadata.videoStreamIndex, 1);
  assert.equal(metadata.useFfmpegSceneDetection, true);
});

test("does not classify process startup failures or canceled decode as unsupported media", async () => {
  for (const error of [Object.assign(new Error("ffmpeg missing"), { code: "ENOENT" }), Object.assign(new Error("aborted"), { name: "AbortError" })]) {
    await assert.rejects(inspectVideoProbe(probe(video()), async () => { throw error; }), actual => actual === error);
  }
});

test("keeps a valid continuous shot distinct from a failed scene detector", async () => {
  const result = { provider: "pyscenedetect", cuts: [] };
  let fallbackCalled = false;
  assert.equal(await detectWithFallback(async () => result, async () => { fallbackCalled = true; }), result);
  assert.equal(fallbackCalled, false);
});

test("recovers a primary detector failure using FFmpeg and rejects when both fail", async () => {
  const fallback = { provider: "ffmpeg_scene_filter", cuts: [3.2, 8.1] };
  let warnings = 0;
  const fail = async () => { throw new Error("decoder failure"); };
  assert.equal(await detectWithFallback(fail, async () => fallback, () => { warnings++; }), fallback);
  assert.equal(warnings, 1);
  await assert.rejects(detectWithFallback(fail, fail), { code: "SCENE_DETECTION_FAILED", statusCode: 422 });
  await assert.rejects(detectWithFallback(async () => null, fail), { code: "SCENE_DETECTION_FAILED" });
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  const cancel = async () => { throw aborted; };
  await assert.rejects(detectWithFallback(cancel, async () => { throw new Error("Must not run after cancellation"); }), actual => actual === aborted);
  await assert.rejects(detectWithFallback(async () => null, cancel), actual => actual === aborted);
});

test("uses another already-resolved URL only after a confirmed codec failure", async () => {
  const calls = [];
  const source = { videoUrl: "https://media/first", videoCandidates: [{ videoUrl: "https://media/first" }, { videoUrl: "https://media/second", audioUrl: "https://media/audio" }] };
  const result = await ingestVideoCandidates(source, async candidate => {
    calls.push(candidate.videoUrl);
    if (calls.length === 1) throw unsupported();
    assert.equal(candidate.audioUrl, "https://media/audio");
    return { inputPath: "source-video" };
  });
  assert.deepEqual(calls, ["https://media/first", "https://media/second"]);
  assert.deepEqual(result, { inputPath: "source-video" });
});

test("does not fall through to more downloads after a network or timeout error", async () => {
  for (const error of [new Error("download failed"), Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })]) {
    let calls = 0;
    await assert.rejects(ingestVideoCandidates({ videoUrl: "https://media/first", videoCandidates: [{ videoUrl: "https://media/second" }] }, async () => { calls++; throw error; }), actual => actual === error);
    assert.equal(calls, 1);
  }
});

test("bounds candidate downloads and stops when the shared ingestion signal is canceled", async () => {
  const source = { videoUrl: "https://media/0", videoCandidates: Array.from({ length: 20 }, (_, index) => ({ videoUrl: `https://media/${index}` })) };
  let calls = 0;
  await assert.rejects(ingestVideoCandidates(source, async () => { calls++; throw unsupported(); }), { code: "UNSUPPORTED_VIDEO_CODEC" });
  assert.equal(calls, 12);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(ingestVideoCandidates(source, async () => { calls++; controller.abort(); throw unsupported(); }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});
