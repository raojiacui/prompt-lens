/**
 * 视频生成 Provider 抽象层
 * 支持多 provider 扩展：Kie.ai, Runway, Pika, Luma 等
 */

import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";
import { db, userApiKeys } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { createKieVeoGeneration, getKieVeoGenerationStatus } from "@/lib/reference-video/kie-veo";

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

export type VideoProviderName = "kie" | "runway" | "pika" | "luma";

// ============ 帮助函数 ============

export async function getUserProviderApiKey(
  userId: string,
  provider: VideoProviderName
): Promise<string | undefined> {
  try {
    const record = await db.query.userApiKeys.findFirst({
      where: and(
        eq(userApiKeys.userId, userId),
        eq(userApiKeys.provider, provider as any)
      ),
    });
    if (record?.apiKey && record.isActive) {
      if (isValidEncryptedKey(record.apiKey)) {
        return decryptApiKey(record.apiKey).trim();
      }
      return record.apiKey.trim();
    }
  } catch (e) {
    console.error(`[video-provider] Failed to get ${provider} API key for user:`, e);
  }
  return undefined;
}

// ============ Kie.ai Provider ============

export const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "wan/2-7-text-to-video";

export class KieVideoProvider implements VideoProvider {
  readonly name = "kie" as const;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createTask(input: CreateVideoTaskInput): Promise<VideoTaskResult> {
    const result = await createKieVeoGeneration({
      prompt: input.prompt,
      duration: input.duration,
      resolution: input.resolution,
      negativePrompt: input.negativePrompt,
      model: input.model || KIE_VIDEO_MODEL,
      aspectRatio: input.aspectRatio,
    }, this.apiKey);

    return { taskId: result.taskId, raw: result.raw };
  }

  async getStatus(taskId: string, model?: string | null): Promise<NormalizedVideoTaskStatus> {
    const status = await getKieVeoGenerationStatus(taskId, model, this.apiKey);
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
  switch (name) {
    case "kie":
      return new KieVideoProvider(apiKey);
    // 以后扩展：
    // case "runway":
    //   return new RunwayVideoProvider(apiKey);
    // case "pika":
    //   return new PikaVideoProvider(apiKey);
    default:
      throw new Error(`Unsupported video provider: ${name}`);
  }
}

// 默认 provider
export const DEFAULT_VIDEO_PROVIDER: VideoProviderName = "kie";
