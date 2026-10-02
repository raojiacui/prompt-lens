import { describe, expect, it } from "vitest";
import { extractVideoLink } from "@/lib/media-resolver/video-link-input";

describe("video link input", () => {
  const url = "https://www.bilibili.com/video/BV11mFLziEyP/?share_source=copy_web&vd_source=2d1f01fb15fea97e13b24d62cf648087";
  it("preserves full URLs and share parameters", () => {
    expect(extractVideoLink(` ${url} `)).toBe(url);
  });
  it("extracts a single URL from a title and share text", () => {
    expect(extractVideoLink(`【【牌子】当世界过分“诚实”，我们要如何保持好奇与勇气】 ${url}`)).toBe(url);
    expect(extractVideoLink(`分享视频：${url}。`)).toBe(url);
    expect(extractVideoLink(`[视频](${url})`)).toBe(url);
  });
  it("rejects missing, multiple, credential-bearing and oversized links", () => {
    for (const input of ["视频标题", `${url} https://b23.tv/example`, "https://user:secret@b23.tv/example", "https://b23.tv:444/example", "a".repeat(4097)]) {
      expect(() => extractVideoLink(input)).toThrow(/格式无效/);
    }
  });
});
