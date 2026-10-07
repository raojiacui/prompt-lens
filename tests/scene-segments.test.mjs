import assert from "node:assert/strict";
import { test } from "node:test";
import { splitLongScenes } from "../workers/ffmpeg-worker/scene-segments.mjs";

test("preserves scenes at or below fifteen seconds", () => {
  const scenes = [{ start: 0, end: 10 }, { start: 10, end: 25 }];
  assert.deepEqual(splitLongScenes(scenes), scenes);
});

test("splits thirty-five seconds into four varied eight-to-ten-second intervals", () => {
  const scenes = [{ start: 26.36, end: 61.36, shotGroupId: "shot-1" }];
  const result = splitLongScenes(scenes, "video-hash");
  assert.equal(result.length, 4);
  assert.equal(result[0].start, 26.36);
  assert.equal(result.at(-1).end, 61.36);
  assert.ok(new Set(result.map((s) => Math.round((s.end - s.start) * 1e6))).size > 1);
  result.forEach((s, index) => {
    assert.ok(s.end - s.start >= 8 - 1e-9 && s.end - s.start <= 10 + 1e-9);
    if (index) assert.equal(s.start, result[index - 1].end);
    assert.equal(s.shotGroupId, `shot-1.0${index + 1}`);
  });
  assert.deepEqual(splitLongScenes(scenes, "video-hash"), result);
  assert.notDeepEqual(splitLongScenes(scenes, "another-video"), result);
});

test("retains detected boundaries and never creates gaps or short tails", () => {
  for (let durationUs = 15_000_001; durationUs < 600_000_000; durationUs += 137_123) {
    const duration = durationUs / 1e6;
    const result = splitLongScenes([{ start: 0, end: duration }], String(durationUs));
    assert.equal(result[0].start, 0);
    assert.equal(result.at(-1).end, duration);
    const feasible = Math.ceil(durationUs / 10e6) <= Math.floor(durationUs / 8e6);
    result.forEach((s, index) => {
      const length = Math.round((s.end - s.start) * 1e6);
      assert.ok(length > 6e6 && length <= 15e6);
      if (feasible) assert.ok(length >= 8e6 && length <= 10e6);
      if (index) assert.equal(s.start, result[index - 1].end);
    });
  }
  const result = splitLongScenes([{ start: 0, end: 35 }, { start: 35, end: 38 }]);
  assert.deepEqual(result.at(-1), { start: 35, end: 38 });
});
