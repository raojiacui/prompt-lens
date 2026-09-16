import { and, eq, sql } from "drizzle-orm";
import { db, operationLogs } from "@/lib/db";
import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import type { SceneInterval } from "./pricing-v6";

export type MediaPreview = { sourceHash: string; durationUs: number; bytes: number; scenes: SceneInterval[]; metadata: FfmpegBreakdownResult["metadata"] };
export async function assertOwnedUploadedVideo(userId: string, mediaUrl: string) {
  const key = extractR2Key(mediaUrl);
  if (!key) throw new Error("UPLOAD_NOT_OWNED");
  const [upload] = await db.select({ id: operationLogs.id }).from(operationLogs).where(and(eq(operationLogs.userId, userId), eq(operationLogs.action, "file.upload"), sql`${operationLogs.metadata}->>'url' = ${mediaUrl}`, sql`${operationLogs.metadata}->>'phase' IN ('presigned','server-upload')`)).limit(1);
  if (!upload) throw new Error("UPLOAD_NOT_OWNED");
  return key;
}
export async function commercialMediaRequest<T>(mediaUrl: string, body: Record<string, unknown>): Promise<T> {
  const worker = process.env.FFMPEG_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.FFMPEG_WORKER_SECRET;
  const key = extractR2Key(mediaUrl);
  if (!worker || !secret || !key) throw new Error("MEDIA_PROBE_NOT_CONFIGURED");
  const response = await fetch(`${worker}/commercial-media`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, videoUrl: await getSignedUrlFromR2(key, 600) }), signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error("MEDIA_PREPARATION_FAILED");
  return await response.json() as T;
}
