import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import { InfistarRequestError } from "./infistar-client";

/** Read only our existing media storage; never fetch arbitrary user-supplied hosts. */
export async function readInfistarMedia(url: string, kind: "image" | "audio" | "video") {
  const maxBytes = (kind === "image" ? 10 : 25) * 1024 * 1024;
  if (kind === "image" && /^data:image\/(png|jpeg|webp);base64,/.test(url)) {
    if (url.length > maxBytes * 1.4) throw new InfistarRequestError("参考素材过大。", undefined, "not_sent");
    const [header, encoded] = url.split(",");
    const bytes = Buffer.from(encoded, "base64");
    return new Blob([bytes], { type: header.slice(5).split(";")[0] });
  }
  const key = extractR2Key(url);
  if (!key) throw new InfistarRequestError("请使用当前站点上传的参考素材。", undefined, "not_sent");
  const signed = await getSignedUrlFromR2(key, 600);
  const response = await fetch(signed, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  const type = response.headers.get("content-type")?.split(";")[0] || "";
  const acceptedType = type.startsWith(`${kind}/`) || (kind === "audio" && type.startsWith("video/"));
  if (!response.ok || !acceptedType || Number(response.headers.get("content-length")) > maxBytes) throw new InfistarRequestError("参考素材无法读取、类型不符或超过大小限制。", undefined, "not_sent");
  if (!response.body) throw new InfistarRequestError("参考素材内容为空。", undefined, "not_sent");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) throw new InfistarRequestError("参考素材超过大小限制。", undefined, "not_sent");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new Blob([Buffer.concat(chunks)], { type });
}
