import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";

export async function streamShotDownload(mediaUrl: string, sceneIndex: number, signal: AbortSignal) {
  const key = extractR2Key(mediaUrl);
  if (!key) throw new Error("SHOT_FILE_UNAVAILABLE");
  const response = await fetch(await getSignedUrlFromR2(key, 300), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]), redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("SHOT_FILE_UNAVAILABLE");
  const contentType = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
  const extension = contentType === "video/webm" ? "webm" : contentType === "video/quicktime" ? "mov" : "mp4";
  return new Response(response.body, { headers: {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="shot-${String(sceneIndex).padStart(2, "0")}.${extension}"`,
    "Cache-Control": "private, no-store",
    ...(response.headers.get("content-length") ? { "Content-Length": response.headers.get("content-length")! } : {}),
  } });
}
