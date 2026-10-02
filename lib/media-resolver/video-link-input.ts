export function extractVideoLink(input: string): string {
  if (input.length > 4096) throw new Error("视频链接格式无效：粘贴内容过长");
  const matches = input.trim().match(/https?:\/\/[^\s<>"`【】（）()]+/gi) || [];
  if (matches.length !== 1) throw new Error("视频链接格式无效：请粘贴一条网址或包含一条网址的分享文本");
  const candidate = matches[0].replace(/[，。；！？、…,;.!]+$/u, "");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("视频链接格式无效");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("视频链接格式无效");
  }
  return url.href;
}
