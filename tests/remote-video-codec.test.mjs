import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { probeRemoteVideoCodec } from "../workers/ffmpeg-worker/remote-video-codec.mjs";

function atom(type, ...parts) {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function track(handler, ...codecs) {
  const hdlr = Buffer.alloc(12);
  hdlr.write(handler, 8, "ascii");
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(codecs.length, 4);
  return atom("trak", atom("mdia", atom("hdlr", hdlr), atom("minf", atom("stbl", atom("stsd", stsd, ...codecs.map(codec => atom(codec, Buffer.alloc(78))))))));
}

const ftyp = atom("ftyp", Buffer.from("isom\0\0\0\0isommp42"));
const movie = (...tracks) => atom("moov", ...tracks);
const file = (tag = "avc1") => Buffer.concat([ftyp, movie(track("vide", tag)), atom("mdat", Buffer.alloc(100_000))]);

function rangedFile(buffer, options = {}) {
  const requests = [];
  let cancellations = 0;
  const fetchImpl = async (_url, init) => {
    requests.push(init);
    const [, rawStart, rawEnd] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    const start = Number(rawStart);
    const end = Math.min(Number(rawEnd), buffer.length - 1);
    if (options.ignoreRange) {
      let sent = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (sent >= buffer.length) { controller.close(); return; }
          controller.enqueue(buffer.subarray(sent, sent + 8192));
          sent += 8192;
        },
        cancel() { cancellations++; },
      }), { status: 200, headers: { "Content-Length": String(buffer.length) } });
    }
    return new Response(buffer.subarray(start, end + 1), {
      status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${buffer.length}` },
    });
  };
  return { requests, fetchImpl, get cancellations() { return cancellations; } };
}

test("accepts declared H.264 and HEVC video codecs without downloading mdat", async () => {
  for (const [tag, codec] of [["avc1", "h264"], ["avc3", "h264"], ["hvc1", "hevc"], ["hev1", "hevc"]]) {
    const remote = rangedFile(file(tag));
    const result = await probeRemoteVideoCodec("https://media.example/no-extension", { headers: { Referer: "https://www.douyin.com/", Authorization: "must-not-forward" } }, remote.fetchImpl);
    assert.equal(result.codec, codec);
    assert.equal(result.codecTag, tag);
    assert.equal(result.bytesRead, 65_536);
    assert.equal(remote.requests.length, 1);
    assert.equal(remote.requests[0].headers.Referer, "https://www.douyin.com/");
    assert.equal(remote.requests[0].headers.Authorization, undefined);
  }
});

test("jumps over a large media atom to inspect tail metadata using Range", async () => {
  const mdat = atom("mdat", Buffer.alloc(8 * 1024 * 1024));
  const buffer = Buffer.concat([ftyp, mdat, movie(track("vide", "hvc1"))]);
  const remote = rangedFile(buffer);
  const result = await probeRemoteVideoCodec("https://media.example/video", {}, remote.fetchImpl);
  assert.equal(result.codec, "hevc");
  assert.equal(remote.requests.length, 2);
  assert.match(remote.requests[1].headers.Range, new RegExp(`^bytes=${ftyp.length + mdat.length}-`));
  assert.ok(result.bytesRead < 66_000, "only prefix and the small tail metadata should transfer");
});

test("skips unsupported video renditions even when another stream or mdat mentions h264", async () => {
  const buffer = Buffer.concat([ftyp, movie(track("soun", "avc1"), track("vide", "bvc2")), atom("mdat", Buffer.from("avc1hvc1"))]);
  const remote = rangedFile(buffer);
  await assert.rejects(probeRemoteVideoCodec("https://media.example/video.mp4", {}, remote.fetchImpl), error => {
    assert.equal(error.code, "UNSUPPORTED_VIDEO_CODEC");
    assert.deepEqual(error.videoCodecs, ["bvc2"]);
    return true;
  });
});

test("selects a supported video track alongside a proprietary track", async () => {
  const remote = rangedFile(Buffer.concat([ftyp, movie(track("vide", "bvc2"), track("vide", "avc1"))]));
  const result = await probeRemoteVideoCodec("https://media.example/video", {}, remote.fetchImpl);
  assert.deepEqual(result.videoCodecs, ["bvc2", "avc1"]);
  assert.equal(result.codec, "h264");
});

test("does not trust extensions, MIME type, unknown sample entries, or encryption wrappers", async () => {
  for (const tag of ["bvc2", "vp09", "av01", "encv"]) {
    const remote = rangedFile(file(tag));
    await assert.rejects(probeRemoteVideoCodec("https://media.example/claimed-h264.mp4", {}, remote.fetchImpl), { code: "UNSUPPORTED_VIDEO_CODEC", statusCode: 422 });
  }
  const unknown = rangedFile(Buffer.from("not an MP4 video regardless of URL suffix"));
  await assert.rejects(probeRemoteVideoCodec("https://media.example/h264.mp4", {}, unknown.fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
});

test("bounds and cancels a host that ignores Range without reading its full body", async () => {
  const remote = rangedFile(file("avc1"), { ignoreRange: true });
  const result = await probeRemoteVideoCodec("https://media.example/video", {}, remote.fetchImpl);
  assert.equal(result.codec, "h264");
  assert.equal(result.bytesRead, 65_536);
  assert.equal(remote.cancellations, 1);

  const tail = rangedFile(Buffer.concat([ftyp, atom("mdat", Buffer.alloc(100_000)), movie(track("vide", "avc1"))]), { ignoreRange: true });
  await assert.rejects(probeRemoteVideoCodec("https://media.example/video", {}, tail.fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
  assert.equal(tail.requests.length, 2);
  assert.equal(tail.cancellations, 2);
});

test("rejects mismatched, truncated, and inconsistent Content-Range responses", async () => {
  for (const header of ["bytes 1-65536/100000", "bytes 0-999999/1000000", "bytes 0-65535/100", "garbage", "bytes 0-65535/100000"]) {
    let canceled = false;
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.alloc(16)); controller.close(); },
      cancel() { canceled = true; },
    }), { status: 206, headers: { "Content-Range": header } });
    await assert.rejects(probeRemoteVideoCodec("https://media.example/video", {}, fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
    if (header !== "bytes 0-65535/100000") assert.equal(canceled, true);
  }
});

test("rejects oversized moov and excessive top-level atoms before requesting their payloads", async () => {
  const huge = rangedFile(Buffer.concat([ftyp, atom("moov", Buffer.alloc(2 * 1024 * 1024)), atom("mdat", Buffer.alloc(1))]));
  await assert.rejects(probeRemoteVideoCodec("https://media.example/video", {}, huge.fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
  assert.equal(huge.requests.length, 1);
  const many = rangedFile(Buffer.concat([ftyp, ...Array.from({ length: 32 }, () => atom("free")), movie(track("vide", "avc1"))]));
  await assert.rejects(probeRemoteVideoCodec("https://media.example/video", {}, many.fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
});

test("handles 64-bit atom sizes and rejects unsafe offsets", async () => {
  const wideHeader = Buffer.alloc(16);
  wideHeader.writeUInt32BE(1);
  wideHeader.write("mdat", 4, "ascii");
  wideHeader.writeBigUInt64BE(70_016n, 8);
  const remote = rangedFile(Buffer.concat([ftyp, wideHeader, Buffer.alloc(70_000), movie(track("vide", "avc3"))]));
  assert.equal((await probeRemoteVideoCodec("https://media.example/video", {}, remote.fetchImpl)).codec, "h264");
  wideHeader.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 8);
  const unsafe = rangedFile(Buffer.concat([ftyp, wideHeader]));
  await assert.rejects(probeRemoteVideoCodec("https://media.example/video", {}, unsafe.fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
});

test("rejects malformed or absent video metadata instead of marking it compatible", async () => {
  for (const moov of [movie(track("soun", "mp4a")), movie(atom("trak", atom("mdia", atom("hdlr", Buffer.from("\0\0\0\0\0\0\0\0vide"))))), movie(atom("trak", Buffer.from("broken")))]) {
    const remote = rangedFile(Buffer.concat([ftyp, moov]));
    await assert.rejects(probeRemoteVideoCodec("https://media.example/video", {}, remote.fetchImpl), { code: "VIDEO_CODEC_PREFLIGHT_FAILED" });
  }
});

test("preserves cancellation and uses a timeout-bound signal for metadata requests", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(probeRemoteVideoCodec("https://media.example/video", { signal: controller.signal }, async () => { calls++; }), { name: "AbortError" });
  assert.equal(calls, 0);
  const active = new AbortController();
  const remote = rangedFile(file());
  await probeRemoteVideoCodec("https://media.example/video", { signal: active.signal }, remote.fetchImpl);
  assert.ok(remote.requests[0].signal instanceof AbortSignal);
  assert.notEqual(remote.requests[0].signal, active.signal);
});

test("cancels metadata body reads when the shared ingestion signal is aborted", async () => {
  const controller = new AbortController();
  let canceled = false;
  const fetchImpl = async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), {
    status: 206, headers: { "Content-Range": "bytes 0-65535/100000" },
  });
  const pending = probeRemoteVideoCodec("https://media.example/video", { signal: controller.signal }, fetchImpl);
  await vi.waitFor(() => assert.equal(controller.signal.aborted, false));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canceled, true);
});
