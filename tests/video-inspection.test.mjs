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

test("preflights alternatives and downloads only the supported rendition", async () => {
  const inspected = [];
  const downloaded = [];
  const source = { videoUrl: "https://media/first", videoCandidates: [{ videoUrl: "https://media/first" }, { videoUrl: "https://media/second", audioUrl: "https://media/audio" }] };
  const result = await ingestVideoCandidates(source, {
    inspect: async candidate => {
      inspected.push(candidate.videoUrl);
      if (inspected.length === 1) throw unsupported();
      return { codec: "h264" };
    },
    download: async candidate => {
      downloaded.push(candidate.videoUrl);
      assert.equal(candidate.audioUrl, "https://media/audio");
      return { inputPath: "source-video" };
    },
  });
  assert.deepEqual(inspected, ["https://media/first", "https://media/second"]);
  assert.deepEqual(downloaded, ["https://media/second"]);
  assert.deepEqual(result, { inputPath: "source-video" });
});

test("skips known unsupported codecs and never downloads an unconfirmed candidate", async () => {
  let inspections = 0;
  let downloads = 0;
  await assert.rejects(ingestVideoCandidates({ videoUrl: "https://media/bvc2", videoCodec: "bvc2", videoCandidates: [{ videoUrl: "https://media/unknown" }] }, {
    inspect: async () => { inspections++; throw Object.assign(new Error("No range support"), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" }); },
    download: async () => { downloads++; },
  }), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
  assert.equal(inspections, 1);
  assert.equal(downloads, 0);
});

test("checks the actual container even when provider metadata claims H.264", async () => {
  let downloads = 0;
  await assert.rejects(ingestVideoCandidates({ videoUrl: "https://media/mislabeled", videoCodec: "h264" }, {
    inspect: async () => ({ codec: "bvc2" }),
    download: async () => { downloads++; },
  }), { code: "UNSUPPORTED_VIDEO_CODEC" });
  assert.equal(downloads, 0);
});

test("keeps final frame validation after preflight and can use another valid rendition", async () => {
  const downloaded = [];
  const result = await ingestVideoCandidates({ videoUrl: "https://media/broken", videoCandidates: [{ videoUrl: "https://media/good" }] }, {
    inspect: async () => ({ codec: "h264" }),
    download: async candidate => {
      downloaded.push(candidate.videoUrl);
      if (downloaded.length === 1) throw Object.assign(new Error("corrupt frame"), { code: "INVALID_VIDEO_STREAM" });
      return "decoded";
    },
  });
  assert.equal(result, "decoded");
  assert.deepEqual(downloaded, ["https://media/broken", "https://media/good"]);
});

test("does not fall through to more downloads after a network or timeout error", async () => {
  for (const error of [new Error("download failed"), Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })]) {
    let calls = 0;
    await assert.rejects(ingestVideoCandidates({ videoUrl: "https://media/first", videoCandidates: [{ videoUrl: "https://media/second" }] }, { inspect: async () => { calls++; throw error; }, download: async () => { throw new Error("Should not download"); } }), actual => actual === error);
    assert.equal(calls, 1);
  }
});

test("bounds candidate probes and stops when the shared ingestion signal is canceled", async () => {
  const source = { videoUrl: "https://media/0", videoCandidates: Array.from({ length: 20 }, (_, index) => ({ videoUrl: `https://media/${index}` })) };
  let calls = 0;
  await assert.rejects(ingestVideoCandidates(source, { inspect: async () => { calls++; throw unsupported(); }, download: async () => { throw new Error("Should not download"); } }), { code: "UNSUPPORTED_VIDEO_CODEC" });
  assert.equal(calls, 12);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(ingestVideoCandidates(source, { inspect: async () => { calls++; controller.abort(); throw unsupported(); }, download: async () => { throw new Error("Should not download"); } }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});
