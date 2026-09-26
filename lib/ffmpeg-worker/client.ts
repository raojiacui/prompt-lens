
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
      signal: AbortSignal.timeout(240000),
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
