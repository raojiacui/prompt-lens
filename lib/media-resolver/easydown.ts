import { sourcePlatform, type LinkedMediaPlatform, type ResolvedLinkedMediaSource } from "./leaperone";

interface EasyDownStream {
  url?: unknown;
  mimeType?: unknown;
  width?: unknown;
  height?: unknown;
  hasAudio?: unknown;
  headers?: unknown;
}

interface EasyDownResponse {
  status?: unknown;
  msg?: unknown;
  data?: {
    title?: unknown;
    duration?: unknown;
    videos?: unknown;
    audios?: unknown;
  } | null;
}

function streams(value: unknown): EasyDownStream[] {
  return Array.isArray(value) ? value.filter((item): item is EasyDownStream => Boolean(item) && typeof item === "object" && typeof item.url === "string" && /^https?:\/\//i.test(item.url)) : [];
}

function score(stream: EasyDownStream) {
  const width = typeof stream.width === "number" ? stream.width : 0;
  const height = typeof stream.height === "number" ? stream.height : 0;
  const mp4 = stream.mimeType === "video/mp4" ? 1_000_000_000 : 0;
  return mp4 + width * height;
}

function publicHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!["referer", "origin", "user-agent"].includes(name.toLowerCase())) continue;
    if (typeof raw === "string" && raw.length <= 2048 && !/[\r\n]/.test(raw)) headers[name] = raw;
  }
  return Object.keys(headers).length ? headers : undefined;
}

export function selectEasyDownMedia(payload: EasyDownResponse, platform: LinkedMediaPlatform): ResolvedLinkedMediaSource {
  const videos = streams(payload.data?.videos).sort((a, b) => score(b) - score(a));
  if (!videos.length) throw new Error("EasyDown 没有返回可下载的视频资源");

  const muxed = videos.find((video) => video.hasAudio === true);
  const video = muxed || videos[0];
  const audio = !muxed && platform === "bilibili"
    ? streams(payload.data?.audios).find((stream) => stream.mimeType === "audio/mp4") || streams(payload.data?.audios)[0]
    : undefined;
  if (!muxed && platform === "bilibili" && !audio) {
    throw new Error("EasyDown 返回了无声视频流，但没有可合并的音频流");
  }

  return {
    platform,
    videoUrl: video.url as string,
    audioUrl: audio?.url as string | undefined,
    videoHeaders: publicHeaders(video.headers),
    audioHeaders: publicHeaders(audio?.headers),
    filename: `${platform}-linked-video.mp4`,
    title: typeof payload.data?.title === "string" ? payload.data.title.trim().slice(0, 160) || undefined : undefined,
    duration: typeof payload.data?.duration === "number" && Number.isFinite(payload.data.duration) ? payload.data.duration : undefined,
  };
}

export async function resolveLinkedMediaWithEasyDown(url: string): Promise<ResolvedLinkedMediaSource> {
  const platform = sourcePlatform(url);
  const apiKey = process.env.EASYDOWN_API_KEY?.trim();
  if (!apiKey) throw new Error("链接解析服务未配置：请设置 EASYDOWN_API_KEY");

  const baseUrl = (process.env.EASYDOWN_API_BASE_URL || "https://api.easydown.org").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/parse`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network request failed";
    throw new Error(`EasyDown 连接失败：${reason}`);
  }

  const payload = await response.json().catch(() => null) as EasyDownResponse | null;
  if (!response.ok || payload?.status !== 200) {
    const message = typeof payload?.msg === "string" ? payload.msg : "解析失败";
    throw new Error(`EasyDown 解析失败（${response.status}）：${message}`);
  }
  if (!payload.data) throw new Error("EasyDown 返回了无效结果");
  return selectEasyDownMedia(payload, platform);
}
