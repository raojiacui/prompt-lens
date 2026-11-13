const failures: Record<string, [string, string]> = {
  KIE_INVALID_RESULT: ["上游模型未返回有效分析结果，可以更换模型重试失败镜头。", "The upstream model returned no valid analysis. Retry failed shots with another model."],
  ANALYSIS_INTERRUPTED: ["本镜头分析中断，未获得有效结果。请查看原任务状态，确认失败后再重试。", "Shot analysis was interrupted without a valid result. Check the original task before retrying."],
  KIE_KEY_REQUIRED: ["模型服务密钥未配置，请检查配置后重试。", "The model service key is missing. Check configuration before retrying."],
  KIE_KEY_CHANGED: ["模型服务密钥已变更，请检查配置后重试。", "The model service key changed. Check configuration before retrying."],
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
