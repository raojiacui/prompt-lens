import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientConnections = new Set(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]);
function connectionCode(error) {
  for (let depth = 0; error && depth < 5; depth++, error = error.cause) {
    if (typeof error.code === "string") return error.code;
  }
}
function downloadError(code, message, attempts, extra = {}) {
  // Do not attach the signed URL, upstream response body or raw exception.
  return Object.assign(new Error(message), { code, statusCode: code === "MEDIA_TOO_LARGE" ? 413 : 502, attempts, ...extra });
}

// Retry storage GETs only, sharing one deadline. Restart partial files from zero.
export async function downloadStorageMedia(url, outputPath, {
  signal, timeoutMs = 60000, maxBytes = 100 * 1024 * 1024,
  fetcher = fetch, wait = delay, onRetry = () => {},
} = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const downloadSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      downloadSignal.throwIfAborted();
      const response = await fetcher(url, { redirect: "error", signal: downloadSignal });
      if (!response.ok || !response.body) {
        const status = response.status;
        await response.body?.cancel().catch(() => {});
        const code = [401, 403].includes(status) ? "MEDIA_SOURCE_FORBIDDEN"
          : [404, 410].includes(status) ? "MEDIA_SOURCE_NOT_FOUND" : "MEDIA_DOWNLOAD_FAILED";
        throw downloadError(code, `Storage download failed (HTTP ${status})`, attempt,
          { sourceStatus: status, retryable: transientStatuses.has(status) || response.ok && !response.body });
      }
      let bytes = 0;
      const hash = createHash("sha256");
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(downloadError("MEDIA_TOO_LARGE", "Media exceeds the allowed size", attempt));
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(response.body, limiter, createWriteStream(outputPath, { flags: "w" }), { signal: downloadSignal });
      return { bytes, sourceHash: hash.digest("hex"), attempts: attempt };
    } catch (error) {
      if (downloadSignal.aborted) throw downloadError("MEDIA_DOWNLOAD_TIMEOUT", "Storage download was canceled or exceeded its deadline", attempt);
      const sourceErrorCode = connectionCode(error);
      const failure = error?.code?.startsWith("MEDIA_") ? error
        : downloadError("MEDIA_DOWNLOAD_FAILED", "Storage connection failed", attempt,
          { sourceErrorCode, retryable: transientConnections.has(sourceErrorCode) });
      if (!failure.retryable || attempt === 3) throw failure;
      onRetry({ attempt, nextAttempt: attempt + 1, code: failure.code, sourceStatus: failure.sourceStatus, sourceErrorCode });
      try { await wait(500 * attempt, undefined, { signal: downloadSignal }); }
      catch { throw downloadError("MEDIA_DOWNLOAD_TIMEOUT", "Storage download was canceled or exceeded its deadline", attempt); }
    }
  }
}
