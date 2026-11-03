import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { downloadStorageMedia } from "../workers/ffmpeg-worker/storage-media-download.mjs";

const folders = [];
async function output() { const folder = await mkdtemp(join(tmpdir(), "storage-download-test-")); folders.push(folder); return join(folder, "video.mp4"); }
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
const url = "https://storage.example/file?private-signature=secret";
const connectionError = () => new TypeError(`fetch failed ${url}`, { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) });

it("recovers a first-download HTTP 503 before doing any extraction or inference", async () => {
  const path = await output();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("video"));
  const onRetry = vi.fn();
  expect(await downloadStorageMedia(url, path, { fetcher, wait: async () => {}, onRetry })).toMatchObject({ bytes: 5, sourceHash: createHash("sha256").update("video").digest("hex"), attempts: 2 });
  expect(await readFile(path, "utf8")).toBe("video");
  expect(onRetry).toHaveBeenCalledWith({ attempt: 1, nextAttempt: 2, code: "MEDIA_DOWNLOAD_FAILED", sourceStatus: 503, sourceErrorCode: "MEDIA_DOWNLOAD_FAILED" });
  expect(fetcher.mock.calls[0][1].signal).toBe(fetcher.mock.calls[1][1].signal);
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
it.each([401, 403, 404, 410])("does not retry a permanent storage HTTP %s response", async status => {
  const fetcher = vi.fn(async () => new Response("private-body", { status }));
  await expect(downloadStorageMedia(url, await output(), { fetcher })).rejects.toMatchObject({ code: [401, 403].includes(status) ? "MEDIA_SOURCE_FORBIDDEN" : "MEDIA_SOURCE_NOT_FOUND", sourceStatus: status, attempts: 1 });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("bounds transient connection retries and never includes credentials in errors", async () => {
  const fetcher = vi.fn(async () => { throw connectionError(); });
  let failure;
  try { await downloadStorageMedia(url, await output(), { fetcher, wait: async () => {} }); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "MEDIA_DOWNLOAD_FAILED", sourceErrorCode: "ECONNRESET", attempts: 3 });
  expect(String(failure) + JSON.stringify(failure)).not.toMatch(/private-signature|secret|storage.example/);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("discards a partial body and restarts the file and hash from zero", async () => {
  const path = await output();
  const partial = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("partial-data")); }, pull(controller) { controller.error(connectionError()); } });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(partial)).mockResolvedValueOnce(new Response("ok"));
  expect(await downloadStorageMedia(url, path, { fetcher, wait: async () => {} })).toMatchObject({ bytes: 2, sourceHash: createHash("sha256").update("ok").digest("hex"), attempts: 2 });
  expect(await readFile(path, "utf8")).toBe("ok");
});
it("stops after the shared deadline is canceled between attempts", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
  await expect(downloadStorageMedia(url, await output(), { signal: controller.signal, fetcher, wait: async () => { controller.abort(); } })).rejects.toMatchObject({ code: "MEDIA_DOWNLOAD_TIMEOUT" });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("does not retry oversized files", async () => {
  const fetcher = vi.fn(async () => new Response("too-big"));
  await expect(downloadStorageMedia(url, await output(), { maxBytes: 2, fetcher })).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE", statusCode: 413 });
  expect(fetcher).toHaveBeenCalledOnce();
});
