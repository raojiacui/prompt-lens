import { getSignedUrlFromR2, extractR2Key } from "@/lib/cloudflare/r2";

export interface FfmpegSceneAsset {
  sceneIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  shotGroupId?: string;
  clipUrl?: string;
  keyframeUrls: string[];
  audioUrl?: string;
  transitionIn?: string;
  transitionOut?: string;
}

export interface FfmpegBreakdownResult {
  metadata: {
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
    hasAudio?: boolean;
  };
  scenes: FfmpegSceneAsset[];
}

const workerUrl = process.env.FFMPEG_WORKER_URL?.replace(/\/$/, "");
const workerSecret = process.env.FFMPEG_WORKER_SECRET;

async function getWorkerDownloadUrl(mediaUrl: string) {
  const key = extractR2Key(mediaUrl);
  if (!key) return mediaUrl;
  try {
    return await getSignedUrlFromR2(key, 7200);
  } catch {
    return mediaUrl;
  }
}

function developmentFallback(mediaUrl: string): FfmpegBreakdownResult {
  return {
    metadata: { duration: 8, hasAudio: true },
    scenes: [
      {
        sceneIndex: 1,
        startTime: 0,
        endTime: 8,
        duration: 8,
        shotGroupId: "shot-001",
        clipUrl: mediaUrl,
        keyframeUrls: [mediaUrl],
        transitionIn: "start",
        transitionOut: "end",
      },
    ],
  };
}

export async function breakdownVideoWithWorker(mediaUrl: string): Promise<FfmpegBreakdownResult> {
  if (!workerUrl) return developmentFallback(mediaUrl);
  if (!workerSecret) throw new Error("FFMPEG_WORKER_SECRET is not configured");

  const response = await fetch(`${workerUrl}/breakdown`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoUrl: await getWorkerDownloadUrl(mediaUrl) }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `FFmpeg worker failed with ${response.status}`);
  }

  if (!payload || !Array.isArray(payload.scenes)) {
    throw new Error("FFmpeg worker returned an invalid breakdown payload");
  }

  return payload as FfmpegBreakdownResult;
}