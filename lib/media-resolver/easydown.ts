import { sourcePlatform, type LinkedMediaPlatform, type ResolvedLinkedMediaSource } from "./source-platform";

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
    media?: {
      title?: unknown;
      duration?: unknown;
      videos?: unknown;
      audios?: unknown;
    } | null;
    platformData?: unknown;
  } | null;
}

type VideoCodec = "h264" | "hevc" | "bvc2";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function codecFromUrlKey(value: unknown): VideoCodec | undefined {
  if (typeof value !== "string") return undefined;
  if (/(?:^|_)(?:bytevc2|bvc2)(?:_|$)/i.test(value)) return "bvc2";
  if (/(?:^|_)(?:bytevc1|bvc1|h265|hevc)(?:_|$)/i.test(value)) return "hevc";
  if (/(?:^|_)(?:h264|avc1)(?:_|$)/i.test(value)) return "h264";
  return undefined;
}

function douyinVideoCodecs(platformData: unknown): Map<string, VideoCodec> {
  const data = record(platformData);
  // The published field table uses video; its full response example uses aweme_detail.video.
  const videos = [record(data?.video), record(record(data?.aweme_detail)?.video)];
  const codecs = new Map<string, VideoCodec>();
  const priority: Record<VideoCodec, number> = { h264: 1, hevc: 2, bvc2: 3 };
  function add(address: unknown, fallback?: VideoCodec) {
    const rendition = record(address);
    const explicit = codecFromUrlKey(rendition?.url_key);
    const codec = explicit === "bvc2" || fallback === "bvc2" ? "bvc2" : explicit || fallback;
    if (!codec || !Array.isArray(rendition?.url_list)) return;
    for (const url of rendition.url_list) {
      if (typeof url !== "string") continue;
      const previous = codecs.get(url);
      if (!previous || priority[codec] > priority[previous]) codecs.set(url, codec);
    }
  }
  for (const video of videos) {
    if (!video) continue;
    add(video.play_addr_h264, "h264");
    add(video.play_addr_265, "hevc");
    add(video.play_addr);
    if (!Array.isArray(video.bit_rate)) continue;
    for (const item of video.bit_rate) {
      const bitrate = record(item);
      // These values are enums. In particular, zero or a missing flag does not prove H.264.
      const codec = bitrate?.is_h265 === 2 || bitrate?.is_bytevc1 === 2 ? "bvc2" : undefined;
      add(bitrate?.play_addr, codec);
    }
  }
  return codecs;
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
  const media = platform === "douyin" ? payload.data?.media || payload.data : payload.data;
  const parsedVideos = streams(media?.videos);
  if (!parsedVideos.length) throw new Error("EasyDown 没有返回可下载的视频资源");
  const codecs = platform === "douyin" ? douyinVideoCodecs(payload.data?.platformData) : new Map<string, VideoCodec>();
  const codecPriority = (stream: EasyDownStream) => {
    const codec = codecs.get(stream.url as string);
    return codec === "h264" ? 2 : codec === "hevc" ? 1 : 0;
  };
  const videos = parsedVideos.filter(video => codecs.get(video.url as string) !== "bvc2")
    .sort((a, b) => codecPriority(b) - codecPriority(a) || Number(b.hasAudio === true) - Number(a.hasAudio === true) || score(b) - score(a));
  if (!videos.length) throw new Error("EasyDown 返回的视频版本编码不受支持，请更换视频或上传兼容文件");

  const audio = platform === "bilibili"
    ? streams(media?.audios).find((stream) => stream.mimeType === "audio/mp4") || streams(media?.audios)[0]
    : undefined;
  if (videos[0].hasAudio !== true && platform === "bilibili" && !audio) {
    throw new Error("EasyDown 返回了无声视频流，但没有可合并的音频流");
  }
  const seen = new Set<string>();
  // MP4 describes the container, so the worker must verify that a rendition can actually decode.
  // Keep alternatives from this one provider response; codec fallback must not spend another parse call.
  const videoCandidates = videos.filter(video => {
    const url = video.url as string;
    if (seen.has(url) || (platform === "bilibili" && video.hasAudio !== true && !audio)) return false;
    seen.add(url);
    return true;
  }).slice(0, 12).map(video => ({
    videoUrl: video.url as string,
    videoCodec: codecs.get(video.url as string),
    audioUrl: video.hasAudio !== true ? audio?.url as string | undefined : undefined,
    videoHeaders: publicHeaders(video.headers),
    audioHeaders: video.hasAudio !== true ? publicHeaders(audio?.headers) : undefined,
  }));

  return {
    platform,
    ...videoCandidates[0],
    videoCandidates: videoCandidates.length > 1 ? videoCandidates : undefined,
    filename: `${platform}-linked-video.mp4`,
    title: typeof media?.title === "string" ? media.title.trim().slice(0, 160) || undefined : undefined,
    duration: typeof media?.duration === "number" && Number.isFinite(media.duration) ? media.duration : undefined,
  };
}

export async function resolveLinkedMediaWithEasyDown(url: string): Promise<ResolvedLinkedMediaSource> {
  const platform = sourcePlatform(url);
  const apiKey = process.env.EASYDOWN_API_KEY?.trim();
  if (!apiKey) throw new Error("链接解析服务未配置：请设置 EASYDOWN_API_KEY");

  const baseUrl = (process.env.EASYDOWN_API_BASE_URL || "https://api.easydown.org").replace(/\/$/, "");
  let response: Response;
  try {
    const endpoint = platform === "douyin" ? "/api/v1/platforms/douyin/parse" : "/api/v1/parse";
    response = await fetch(`${baseUrl}${endpoint}`, {
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
