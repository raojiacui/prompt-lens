/**
 * @deprecated 请使用 video-provider.ts
 * 本文件仅保留类型导出，保持向后兼容
 */

// 重新导出所有类型
export type {
  VideoGenerationStatus,
  CreateVideoTaskInput,
  NormalizedVideoTaskStatus,
  VideoTaskResult,
  VideoProvider,
  VideoProviderName,
} from "./video-provider";

export {
  createVideoProvider,
  DEFAULT_VIDEO_PROVIDER,
  KieVideoProvider,
  getUserProviderApiKey,
  KIE_VIDEO_MODEL,
} from "./video-provider";
