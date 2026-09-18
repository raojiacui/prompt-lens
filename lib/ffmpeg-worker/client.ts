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


export interface LinkedMediaResolveResult {
  mediaUrl: string;
  storageKey?: string;
  mediaType: "video";
  platform: "youtube" | "tiktok" | "douyin" | "x" | "bilibili";
  filename?: string;
  metadata: FfmpegBreakdownResult["metadata"];
}
export interface FfmpegBreakdownResult {
  metadata: {
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
    hasAudio?: boolean;
    audioPreviewUrl?: string;
    audioPreviewDuration?: number;
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


export async function ingestLinkedMediaWithWorker(source: {
  platform: LinkedMediaResolveResult["platform"];
  videoUrl: string;
  audioUrl?: string;
  filename?: string;
}): Promise<LinkedMediaResolveResult> {
  if (!workerUrl) throw new Error("媒体入库服务未配置：请设置 FFMPEG_WORKER_URL。");
  if (!workerSecret) throw new Error("媒体入库服务未配置：请设置 FFMPEG_WORKER_SECRET。");

  let response: Response;
  try {
    response = await fetch(`${workerUrl}/ingest-media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(source),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network request failed";
    throw new Error(`媒体入库服务连接失败：${reason}。请检查 FFMPEG_WORKER_URL/FFMPEG_WORKER_SECRET 配置。`);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Link resolver failed with ${response.status}`);
  }
  if (!payload?.mediaUrl || !payload?.metadata) {
    throw new Error("链接解析服务返回了无效结果");
  }
  return payload as LinkedMediaResolveResult;
}
export async function breakdownVideoWithWorker(mediaUrl: string): Promise<FfmpegBreakdownResult> {
  if (!workerUrl) return developmentFallback(mediaUrl);
  if (!workerSecret) throw new Error("FFMPEG_WORKER_SECRET is not configured");

  let response: Response;
  try {
    response = await fetch(`${workerUrl}/breakdown`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoUrl: await getWorkerDownloadUrl(mediaUrl) }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network request failed";
    throw new Error(`视频拆解服务连接失败：${reason}。请检查 FFMPEG_WORKER_URL/FFMPEG_WORKER_SECRET 配置，以及该服务是否能访问上传后的视频 URL。`);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `FFmpeg worker failed with ${response.status}`);
  }

  if (!payload || !Array.isArray(payload.scenes)) {
    throw new Error("FFmpeg worker returned an invalid breakdown payload");
  }

  return payload as FfmpegBreakdownResult;
}
