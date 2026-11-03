const failures: Record<string, [string, string]> = {
  MEDIA_PREPARATION_FAILED: ["镜头素材准备失败，模型分析尚未开始。", "Shot media preparation failed before model analysis started."],
  MEDIA_DOWNLOAD_FAILED: ["视频素材下载失败，模型分析尚未开始。", "Video download failed before model analysis started."],
  MEDIA_DOWNLOAD_TIMEOUT: ["视频素材下载超时，模型分析尚未开始。", "Video download timed out before model analysis started."],
  MEDIA_SOURCE_FORBIDDEN: ["存储服务拒绝读取视频，请检查素材访问权限。模型分析尚未开始。", "Storage denied access to the video. Check media access permissions; model analysis has not started."],
  MEDIA_SOURCE_NOT_FOUND: ["存储中的视频已找不到，请检查素材是否过期或被删除。", "The video was not found in storage. Check whether the media expired or was deleted."],
  MEDIA_TOO_LARGE: ["视频素材超过大小限制，模型分析尚未开始。", "Video exceeds the size limit; model analysis has not started."],
};
export function analysisFailureMessage(code: unknown, language: string) {
  return typeof code === "string" ? failures[code]?.[language === "en" ? 1 : 0] : undefined;
}
