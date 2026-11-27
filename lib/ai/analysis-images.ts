type Message = { role: string; content: unknown };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 14 * 1024 * 1024;

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
}

// Read only our configured storage. Never turn user-provided image URLs into
// arbitrary server-side requests or forward a provider credential to storage.
export async function inlineAnalysisImages(messages: Message[], signal: AbortSignal): Promise<Message[]> {
  let total = 0;
  const cache = new Map<string, { data: string; size: number }>();
  async function inline(url: string) {
    const cached = cache.get(url);
    if (cached) {
      total += cached.size;
      if (total > MAX_TOTAL_BYTES) throw new Error("ANALYSIS_IMAGE_TOO_LARGE");
      return cached.data;
    }
    let bytes: Buffer;
    if (url.startsWith("data:")) {
      const match = /^data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
      if (!match || match[1].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("ANALYSIS_IMAGE_INVALID_OR_TOO_LARGE");
      bytes = Buffer.from(match[1], "base64");
    } else {
      const { extractR2Key, getSignedUrlFromR2 } = await import("@/lib/cloudflare/r2");
      const key = extractR2Key(url);
      if (!key) throw new Error("ANALYSIS_IMAGE_SOURCE_FORBIDDEN");
      const response = await fetch(await getSignedUrlFromR2(key, 60), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), redirect: "error", cache: "no-store",
      });
      if (!response.ok || !response.body) throw new Error("ANALYSIS_IMAGE_DOWNLOAD_FAILED");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("ANALYSIS_IMAGE_TOO_LARGE");
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > MAX_IMAGE_BYTES || total + size > MAX_TOTAL_BYTES) throw new Error("ANALYSIS_IMAGE_TOO_LARGE");
          chunks.push(chunk.value);
        }
        bytes = Buffer.concat(chunks);
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    total += bytes.length;
    const mime = imageMime(bytes);
    if (!mime || bytes.length > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) throw new Error("ANALYSIS_IMAGE_INVALID_OR_TOO_LARGE");
    const data = `data:${mime};base64,${bytes.toString("base64")}`;
    cache.set(url, { data, size: bytes.length });
    return data;
  }
  const result: Message[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) { result.push(message); continue; }
    const content = [];
    for (const part of message.content) {
      // Audio/video use their existing protocol; only image inputs are inlined.
      const url = part?.type === "image_url" ? part.image_url?.url : undefined;
      if (typeof url === "string" && !/\.(?:mp4|mov|webm|m4a|mp3)(?:\?|$)/i.test(url)) {
        content.push({ ...part, image_url: { ...part.image_url, url: await inline(url) } });
      } else content.push(part);
    }
    result.push({ ...message, content });
  }
  return result;
}
