import { test } from "vitest";
import assert from "node:assert/strict";
import { fetchMedia } from "../workers/ffmpeg-worker/media-fetch.mjs";

const url = "https://media.example.com/video?private=secret";
const failure = (code) => new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });

test("retries transient DNS errors using the same media URL", async () => {
  let calls = 0;
  const result = await fetchMedia(url, {}, async (actual) => {
    assert.equal(actual, url);
    if (++calls < 3) throw failure("EAI_AGAIN");
    return new Response("ok");
  }, async () => {});
  assert.equal(calls, 3);
  assert.equal(await result.text(), "ok");
});

test("limits retries and reports DNS failure without the signed URL", async () => {
  let calls = 0;
  await assert.rejects(fetchMedia(url, {}, async () => { calls++; throw failure("EAI_AGAIN"); }, async () => {}), (error) => {
    assert.match(error.message, /EAI_AGAIN/);
    assert.match(error.message, /media.example.com/);
    assert.ok(!error.message.includes("private"));
    return true;
  });
  assert.equal(calls, 3);
});

test("does not retry permanent DNS failures or HTTP errors", async () => {
  let calls = 0;
  await assert.rejects(fetchMedia(url, {}, async () => { calls++; throw failure("ENOTFOUND"); }), /ENOTFOUND/);
  assert.equal(calls, 1);
  const response = await fetchMedia(url, {}, async () => new Response("denied", { status: 403 }));
  assert.equal(response.status, 403);
});

test("does not retry canceled requests", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const error = failure("EAI_AGAIN");
  await assert.rejects(fetchMedia(url, { signal: controller.signal }, async () => { calls++; throw error; }), (actual) => actual === error);
  assert.equal(calls, 1);
});
