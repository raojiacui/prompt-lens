export type LinkedMediaPlatform = "youtube" | "tiktok" | "douyin" | "x" | "bilibili";

export interface ResolvedLinkedMediaSource {
  platform: LinkedMediaPlatform;
  videoUrl: string;
  audioUrl?: string;
  filename: string;
  title?: string;
  duration?: number;
}

interface LeaperMediaStream {
  url?: unknown;
  quality?: unknown;
  format?: unknown;
  codec?: unknown;
  width?: unknown;
  height?: unknown;
  size?: unknown;
  hasAudio?: unknown;
  isMuxed?: unknown;
}

interface LeaperResponse {
  platform?: unknown;
  data?: {
    title?: unknown;
    duration?: unknown;
    videos?: unknown;
    audios?: unknown;
  } | null;
  error?: unknown;
  message?: unknown;
}

const DEFAULT_BASE_URL = "https://api.leaper.one";

function sourcePlatform(url: string): LinkedMediaPlatform {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("视频链接格式无效");
  }

  if (hostname === "youtu.be" || hostname.endsWith(".youtube.com") || hostname === "youtube.com") return "youtube";
  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok";
  if (["douyin.com", "iesdouyin.com", "amemv.com"].some((host) => hostname === host || hostname.endsWith(`.${host}`))) return "douyin";
  if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "x";
  if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com") || hostname === "b23.tv" || hostname.endsWith(".b23.tv")) return "bilibili";
  throw new Error("目前仅支持 YouTube、TikTok、X、抖音和 Bilibili 的公开视频链接");
}

function asStreams(value: unknown): LeaperMediaStream[] {
  return Array.isArray(value) ? value.filter((item): item is LeaperMediaStream => Boolean(item) && typeof item === "object") : [];
}

function streamUrl(stream: LeaperMediaStream) {
  return typeof stream.url === "string" && /^https?:\/\//i.test(stream.url) ? stream.url : undefined;
}

function streamScore(stream: LeaperMediaStream) {
  const width = typeof stream.width === "number" ? stream.width : 0;
  const height = typeof stream.height === "number" ? stream.height : 0;
  const size = typeof stream.size === "number" ? stream.size : 0;
  const quality = typeof stream.quality === "string" ? Number.parseInt(stream.quality, 10) || 0 : 0;
  const mp4Bonus = String(stream.format || "").toLowerCase() === "mp4" ? 1_000_000_000 : 0;
  return mp4Bonus + width * height + quality * 1_000 + Math.min(size, 999);
}

function hasEmbeddedAudio(stream: LeaperMediaStream) {
  if (stream.hasAudio === true || stream.isMuxed === true) return true;
  const codec = typeof stream.codec === "string" ? stream.codec.toLowerCase() : "";
  return codec.includes(",") || codec.includes("mp4a") || codec.includes("opus") || codec.includes("aac");
}

export function selectLeaperMedia(payload: LeaperResponse, requestedPlatform: LinkedMediaPlatform): ResolvedLinkedMediaSource {
  const videos = asStreams(payload.data?.videos).filter((stream) => Boolean(streamUrl(stream))).sort((a, b) => streamScore(b) - streamScore(a));
  if (!videos.length) throw new Error("LEAPERone 没有返回可下载的视频资源");

  const requiresSeparateAudio = requestedPlatform === "youtube" || requestedPlatform === "bilibili";
  const muxed = requiresSeparateAudio ? videos.find(hasEmbeddedAudio) : videos[0];
  const selectedVideo = muxed || videos[0];
  const selectedAudio = !muxed && requiresSeparateAudio
    ? asStreams(payload.data?.audios).find((stream) => Boolean(streamUrl(stream)))
    : undefined;

  if (requiresSeparateAudio && !muxed && !selectedAudio) {
    throw new Error("LEAPERone 返回了无声视频流，但没有可合并的音频流");
  }

  return {
    platform: requestedPlatform,
    videoUrl: streamUrl(selectedVideo)!,
    audioUrl: selectedAudio ? streamUrl(selectedAudio) : undefined,
    filename: `${requestedPlatform}-linked-video.mp4`,
    title: typeof payload.data?.title === "string" ? payload.data.title.trim().slice(0, 160) || undefined : undefined,
    duration: typeof payload.data?.duration === "number" && Number.isFinite(payload.data.duration) ? payload.data.duration : undefined,
  };
}

export async function resolveLinkedMediaWithLeaperOne(url: string): Promise<ResolvedLinkedMediaSource> {
  const platform = sourcePlatform(url);
  const apiKey = process.env.LEAPERONE_API_KEY?.trim();
  if (!apiKey) throw new Error("链接解析服务未配置：请设置 LEAPERONE_API_KEY");

  const baseUrl = (process.env.LEAPERONE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const endpoint = new URL(`${baseUrl}/v1/social-media/video/extract`);
  endpoint.searchParams.set("url", url);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network request failed";
    throw new Error(`LEAPERone 连接失败：${reason}`);
  }

  const payload = await response.json().catch(() => null) as LeaperResponse | null;
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : typeof payload?.error === "string" ? payload.error : "解析失败";
    throw new Error(`LEAPERone 解析失败（${response.status}）：${message}`);
  }
  if (!payload?.data) throw new Error("LEAPERone 返回了无效结果");
  return selectLeaperMedia(payload, platform);
}
