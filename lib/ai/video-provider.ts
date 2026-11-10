/**
 * 视频生成 Provider 抽象层
 * 支持 KIE 与 Infistar 的独立模型和接口
 */

import { createProviderVideo, getProviderVideoStatus } from "./video-client";
import type { UserProvider } from "./providers";

// ============ 类型定义 ============

export type VideoGenerationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface CreateVideoTaskInput {
  prompt: string;
  duration?: number;
  resolution?: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio?: string;
}

export interface NormalizedVideoTaskStatus {
  status: VideoGenerationStatus;
  progress?: number | string;
  videoUrl?: string;
  error?: string;
  raw: unknown;
}

export interface VideoTaskResult {
  taskId: string;
  raw: unknown;
}

export interface VideoProvider {
  readonly name: string;
  createTask(input: CreateVideoTaskInput): Promise<VideoTaskResult>;
  getStatus(taskId: string, model?: string | null): Promise<NormalizedVideoTaskStatus>;
}

// ============ Provider 名称枚举 ============

export type VideoProviderName = UserProvider;

// ============ 供应商实现 ============

export const DEFAULT_KIE_VIDEO_MODEL = "bytedance/seedance-2-fast";

export class ConfiguredVideoProvider implements VideoProvider {
  private apiKey: string;

  constructor(readonly name: UserProvider, apiKey: string) {
    this.apiKey = apiKey;
  }

  async createTask(input: CreateVideoTaskInput): Promise<VideoTaskResult> {
    const result = await createProviderVideo(this.name, {
      prompt: input.prompt,
      duration: input.duration,
      resolution: input.resolution,
      negativePrompt: input.negativePrompt,
      model: input.model || (this.name === "infistar" ? "doubao-seedance-2.0-mini" : DEFAULT_KIE_VIDEO_MODEL),
      aspectRatio: input.aspectRatio,
    }, this.apiKey);

    return { taskId: result.taskId, raw: result.raw };
  }

  async getStatus(taskId: string, model?: string | null): Promise<NormalizedVideoTaskStatus> {
    const status = await getProviderVideoStatus(this.name, taskId, model, this.apiKey);
    if (status.state === "success") {
      return { status: status.videoUrl ? "completed" : "processing", videoUrl: status.videoUrl, raw: status.raw };
    }
    if (status.state === "fail") {
      return { status: "failed", error: status.error || "Video generation failed", raw: status.raw };
    }
    return { status: "processing", raw: status.raw };
  }
}

// ============ Provider 工厂 ============

export function createVideoProvider(name: VideoProviderName, apiKey: string): VideoProvider {
  return new ConfiguredVideoProvider(name, apiKey);
}

// 默认 provider
export const DEFAULT_VIDEO_PROVIDER: VideoProviderName = "kie";
