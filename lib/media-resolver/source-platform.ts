export type LinkedMediaPlatform = "tiktok" | "douyin" | "bilibili";

export interface ResolvedLinkedMediaSource {
  platform: LinkedMediaPlatform;
  videoUrl: string;
  audioUrl?: string;
  videoHeaders?: Record<string, string>;
  audioHeaders?: Record<string, string>;
  filename: string;
  title?: string;
  duration?: number;
}

export function sourcePlatform(url: string): LinkedMediaPlatform {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("视频链接格式无效");
  }

  if (hostname === "youtu.be" || hostname.endsWith(".youtube.com") || hostname === "youtube.com") throw new Error("暂不支持 YouTube 视频链接");
  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok";
  if (["douyin.com", "iesdouyin.com", "amemv.com"].some((host) => hostname === host || hostname.endsWith(`.${host}`))) return "douyin";
  if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) throw new Error("暂不支持 X 视频链接");
  if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com") || hostname === "b23.tv" || hostname.endsWith(".b23.tv")) return "bilibili";
  throw new Error("目前仅支持 TikTok、抖音和 Bilibili 的公开视频链接");
}
