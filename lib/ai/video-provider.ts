/**
 * 视频生成 Provider 抽象层
 * 支持多 provider 扩展：Kie.ai, Runway, Pika, Luma 等
 */

import { decryptApiKey } from "@/lib/utils/encryption";
import { db, userApiKeys } from "@/lib/db";
import { and, eq } from "drizzle-orm";

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
  getStatus(taskId: string): Promise<NormalizedVideoTaskStatus>;
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
    if (record?.apiKey) {
      return decryptApiKey(record.apiKey);
    }
  } catch (e) {
    console.error(`[video-provider] Failed to get ${provider} API key for user:`, e);
  }
  return undefined;
}

// ============ Kie.ai Provider ============

const KIE_API_BASE_URL = process.env.KIE_API_BASE_URL || "https://api.kie.ai";
export const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "wan/2-7-text-to-video";

function kieBuildHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function parseResultJson(resultJson: unknown): Record<string, unknown> {
  if (!resultJson) return {};
  if (typeof resultJson === "object") return resultJson as Record<string, unknown>;
  if (typeof resultJson !== "string") return {};
  try {
    return JSON.parse(resultJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string" && item.length > 0);
  }
  return undefined;
}

function extractVideoUrl(data: any): string | undefined {
  const result = parseResultJson(data?.resultJson);
  return (
    firstString(result.resultUrls) ||
    firstString(result.videoUrls) ||
    firstString(result.urls) ||
    firstString(result.url) ||
    firstString(data?.videoUrl) ||
    firstString(data?.url)
  );
}

export class KieVideoProvider implements VideoProvider {
  readonly name = "kie" as const;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createTask(input: CreateVideoTaskInput): Promise<VideoTaskResult> {
    const prompt = input.prompt.trim();
    const negativePrompt = input.negativePrompt?.trim();
    const duration = Number.isFinite(input.duration) ? input.duration : 5;

    const modelInput = KIE_VIDEO_MODEL.startsWith("wan/")
      ? {
          prompt,
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
          resolution: input.resolution || "720p",
          ratio: "16:9",
          duration,
          prompt_extend: true,
          watermark: false,
        }
      : {
          prompt: negativePrompt ? `${prompt}\nNegative prompt: ${negativePrompt}` : prompt,
          aspect_ratio: "landscape",
          n_frames: String(duration),
          remove_watermark: true,
          upload_method: "s3",
        };

    const payload = { model: KIE_VIDEO_MODEL, input: modelInput };

    const response = await fetch(`${KIE_API_BASE_URL}/api/v1/jobs/createTask`, {
      method: "POST",
      headers: kieBuildHeaders(this.apiKey),
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    const taskId = data?.data?.taskId || data?.data?.task_id || data?.taskId || data?.task_id;

    if (!response.ok || data?.code !== 200 || !taskId) {
      throw new Error(data?.msg || data?.message || `Kie task creation failed (${response.status})`);
    }

    return { taskId, raw: data };
  }

  async getStatus(taskId: string): Promise<NormalizedVideoTaskStatus> {
    const url = new URL(`${KIE_API_BASE_URL}/api/v1/jobs/recordInfo`);
    url.searchParams.set("taskId", taskId);

    const response = await fetch(url, { headers: kieBuildHeaders(this.apiKey) });
    const body = await response.json().catch(() => null);

    if (!response.ok || (body?.code !== undefined && body.code !== 200)) {
      throw new Error(body?.msg || body?.message || `Kie status query failed (${response.status})`);
    }

    const data = body?.data || body;
    const state = String(data?.state || data?.status || "").toLowerCase();

    if (state === "success" || state === "completed" || state === "done") {
      const videoUrl = extractVideoUrl(data);
      return { status: videoUrl ? "completed" : "processing", progress: data?.progress, videoUrl, raw: body };
    }

    if (state === "fail" || state === "failed" || state === "error") {
      return {
        status: "failed",
        progress: data?.progress,
        error: data?.failMsg || data?.error || body?.msg || "Video generation failed",
        raw: body,
      };
    }

    return {
      status: state === "waiting" || state === "queuing" ? "pending" : "processing",
      progress: data?.progress,
      raw: body,
    };
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
