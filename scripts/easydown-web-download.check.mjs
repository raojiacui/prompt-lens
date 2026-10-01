import assert from "node:assert/strict";
import { test } from "node:test";
import { selectStreams, validateVideoUrl } from "./easydown-web-download.mjs";

test("only accepts supported public platform HTTPS hosts", () => {
  assert.equal(validateVideoUrl("https://www.douyin.com/video/123"), "https://www.douyin.com/video/123");
  for (const url of ["http://www.douyin.com/video/1", "https://localhost/", "https://douyin.com.evil.com/", "https://user:secret@www.tiktok.com/"]) {
    assert.throws(() => validateVideoUrl(url));
  }
});

test("picks higher resolution video and highest bitrate audio for DASH", () => {
  const selected = selectStreams([
    { id: "low", description: "360P video/mp4 DASH video only" },
    { id: "high", description: "480P video/mp4 DASH 仅限视频" },
    { id: "audio-low", description: "音频 66kbps audio/mp4" },
    { id: "audio-high", description: "音频 172kbps audio/mp4" },
  ]);
  assert.deepEqual(selected.map((stream) => stream.id), ["high", "audio-high"]);
});

test("prefers a complete video and rejects missing audio for video-only streams", () => {
  assert.equal(selectStreams([
    { id: "silent", description: "1080P video/mp4 video only" },
    { id: "complete", description: "720P video/mp4 with audio" },
  ])[0].id, "complete");
  assert.throws(() => selectStreams([{ id: "silent", description: "480P video/mp4 仅限视频" }]));
  assert.throws(() => selectStreams([]));
});
