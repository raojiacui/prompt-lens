import { and, eq, sql } from "drizzle-orm";
import { db, operationLogs } from "@/lib/db";
import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import type { SceneInterval } from "./pricing-v6";

export type MediaPreview = { sourceHash: string; durationUs: number; bytes: number; scenes: SceneInterval[]; metadata: FfmpegBreakdownResult["metadata"] };
export async function assertOwnedUploadedVideo(userId: string, mediaUrl: string, mediaType?: "video" | "image") {
  const key = extractR2Key(mediaUrl);
  if (!key) throw new Error("UPLOAD_NOT_OWNED");
  const [upload] = await db.select({ id: operationLogs.id }).from(operationLogs).where(and(eq(operationLogs.userId, userId), eq(operationLogs.action, "file.upload"), eq(operationLogs.resourceType, mediaType || "video"), sql`${operationLogs.metadata}->>'url' = ${mediaUrl}`, sql`${operationLogs.metadata}->>'storageKey' = ${key}`, sql`${operationLogs.metadata}->>'phase' IN ('completed','server-upload')`)).limit(1);
  if (!upload) throw new Error("UPLOAD_NOT_OWNED");
  return key;
}
export async function isOwnedLinkedVideo(userId: string, mediaUrl: string) {
  await assertOwnedUploadedVideo(userId, mediaUrl);
  const [imported] = await db.select({ id: operationLogs.id }).from(operationLogs).where(and(eq(operationLogs.userId, userId), eq(operationLogs.action, "file.upload"), eq(operationLogs.resourceType, "video"), sql`${operationLogs.metadata}->>'url' = ${mediaUrl}`, sql`${operationLogs.metadata}->>'storageKey' = ${extractR2Key(mediaUrl)}`, sql`${operationLogs.metadata}->>'source' = 'linked-media'`, sql`${operationLogs.metadata}->>'phase' IN ('completed','server-upload')`)).limit(1);
  return Boolean(imported);
}
export async function commercialMediaRequest<T>(mediaUrl: string, body: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T> {
  const worker = process.env.FFMPEG_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.FFMPEG_WORKER_SECRET;
  const key = extractR2Key(mediaUrl);
  if (!worker || !secret || !key) throw new Error("MEDIA_PROBE_NOT_CONFIGURED");
  const response = await fetch(`${worker}/commercial-media`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, videoUrl: await getSignedUrlFromR2(key, 600) }), signal: AbortSignal.timeout(options?.timeoutMs ?? 240000) });
  if (!response.ok) {
    // Keep a bounded worker explanation in the cause so task diagnostics can redact it.
    let reason = "Media worker rejected the request";
    let code = "MEDIA_PREPARATION_FAILED";
    try {
      const payload = await response.json() as { error?: unknown; code?: unknown };
      if (typeof payload.error === "string") reason = payload.error.slice(0, 1000);
      if (["UNSUPPORTED_VIDEO_CODEC", "INVALID_VIDEO_STREAM", "SCENE_DETECTION_FAILED", "MEDIA_STORAGE_CONFIG_INVALID", "INVALID_MEDIA_URL"].includes(String(payload.code))) code = String(payload.code);
    } catch { /* A proxy may return HTML instead of the worker's JSON response. */ }
    throw new Error(code, { cause: Object.assign(new Error(reason), { code: `MEDIA_HTTP_${response.status}` }) });
  }
  return await response.json() as T;
}
