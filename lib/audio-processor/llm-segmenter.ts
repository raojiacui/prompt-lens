import axios from "axios";
import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";
import { getDefaultWhisperModel, WhisperModelSize } from "./index";
import path from "path";

// ============ 类型定义 ============

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoSegment {
  start: number;
  end: number;
  summary: string;
  tags: string[];
}

export interface TranscriptionResult {
  language: string;
  segments: TranscriptionSegment[];
  duration: number;
}

export interface LLMResult {
  segments: VideoSegment[];
}

// ============ API 配置 ============

const LLM_API_CONFIGS = {
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4-flash",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
    model: "gemini-2.0-flash-exp",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemini-2.0-flash-exp",
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
};

export type LLMProvider = "zhipu" | "gemini" | "openrouter" | "deepseek";

// ============ Whisper 语音识别 ============

/**
 * 使用硅基流动 Whisper API 进行语音识别
 */
export async function transcribeAudio(
  audioPath: string,
  modelSize: WhisperModelSize = getDefaultWhisperModel()
): Promise<TranscriptionResult> {
  console.log(`Starting transcription for: ${audioPath}`);

  try {
    // 读取音频文件
    const fs = await import("fs");
    const audioBuffer = fs.readFileSync(audioPath);

    // 使用本地 faster-whisper 进行语音识别（免费！）
    try {
      const { execSync } = await import("child_process");
      const path = await import("path");

      // 获取脚本路径
      const scriptPath = path.join(process.cwd(), "scripts", "local-whisper.py");

      // 调用本地 whisper 脚本
      const result = execSync(
        `python "${scriptPath}" "${audioPath}" --model tiny`,
        { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
      );

      console.log("Whisper output:", result.substring(0, 500));

      const data = JSON.parse(result);

      return {
        language: data.language || "zh",
        segments: data.segments || [],
        duration: data.duration || 0,
      };
    } catch (error: any) {
      console.error("Local Whisper error:", error.message);
      throw new Error(`语音识别失败: ${error.message}`);
    }
  } catch (error: any) {
    console.error("Whisper transcription failed:", error);
    // 返回示例数据，让用户可以测试流程
    return {
      language: "zh",
      segments: [
        { start: 0, end: 5, text: "语音识别暂时不可用，这是演示数据。你可以手动编辑这些内容来测试后续的分段功能。" },
      ],
      duration: 5,
    };
  }
}

/**
 * 创建 FormData
 */
function createFormData(base64Audio: string, mimeType: string): FormData {
  const byteCharacters = atob(base64Audio);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const formData = new FormData();
  formData.append("file", blob, "audio.wav");
  formData.append("model", "paraformer-realtime-v2");
  formData.append("response_format", "verbose_json");
  formData.append("language", "auto");

  return formData;
}

// ============ LLM 智能分段 ============

/**
 * 获取用户的 API Key
 */
async function getUserApiKey(userId: string, provider: LLMProvider): Promise<string | null> {
  // 如果使用 deepseek，从环境变量获取
  if (provider === "deepseek") {
    return process.env.DEEPSEEK_API_KEY || null;
  }

  const result = await db.query.userApiKeys.findFirst({
    where: eq(userApiKeys.userId, userId),
  });

  if (!result || !result.isActive) {
    return null;
  }

  // 解密 API Key（支持加密和未加密的旧数据）
  try {
    if (isValidEncryptedKey(result.apiKey)) {
      return decryptApiKey(result.apiKey);
    }
    // 兼容旧数据：未加密的明文
    return result.apiKey;
  } catch (error) {
    console.error(`[LLM] Failed to decrypt API key for ${provider}:`, error);
    return null;
  }
}

/**
 * 调用智谱AI API
 */
async function callZhipuApi(apiKey: string, messages: any[]): Promise<string> {
  const response = await axios.post(
    LLM_API_CONFIGS.zhipu.url,
    {
      model: LLM_API_CONFIGS.zhipu.model,
      messages: messages,
      max_tokens: 4096,
      temperature: 0.3,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 120,
    }
  );

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}

/**
 * 调用 DeepSeek API
 */
async function callDeepSeekApi(apiKey: string, messages: any[]): Promise<string> {
  const response = await axios.post(
    LLM_API_CONFIGS.deepseek.url,
    {
      model: LLM_API_CONFIGS.deepseek.model,
      messages: messages,
      max_tokens: 4096,
      temperature: 0.3,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 120,
    }
  );

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}

/**
 * 调用 LLM 进行智能分段
 */
export async function segmentWithLLM(
  userId: string,
  transcription: TranscriptionSegment[],
  provider: LLMProvider = "deepseek",
  customPrompt?: string
): Promise<LLMResult> {
  const apiKey = await getUserApiKey(userId, provider);

  if (!apiKey) {
    // 如果没有 API Key，返回默认分段（按句子分段）
    return segmentBySentences(transcription);
  }

  // 构建系统提示
  const systemPrompt = `你是一个专业的视频剪辑助手，需要根据提供的字幕内容将视频处理成有意义的片段。
每个片段应该包含以下信息：开始时间(秒)，结束时间(秒)，一句话的内容摘要和1-3个主题标签。
不同片段的长度不要相差太多，单个片段最长尽量不要超过总时长的30%，但还是优先考虑主题连贯性。
返回格式必须是JSON，包含一个数组，每个元素有四个键：start, end, summary, tags。
只返回JSON数组，不要其他内容。`;

  // 构建字幕内容
  const subtitlesContent = transcription
    .map((seg) => `[${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  // 用户提示
  const userPrompt = customPrompt || `请根据以下字幕内容，将视频分成若干个有意义的片段。
每个片段应包含连贯的主题内容，并给出一句话摘要和1-3个主题标签。
时间信息需要精确到秒。
\n\n字幕内容：\n${subtitlesContent}`;

  try {
    let result: string;

    if (provider === "deepseek") {
      result = await callDeepSeekApi(apiKey, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
    } else {
      result = await callZhipuApi(apiKey, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
    }

    // 解析 JSON 结果
    const segments = parseLLMResponse(result);
    return { segments };
  } catch (error) {
    console.error("LLM segmentation error:", error);
    // 出错时使用默认分段
    return segmentBySentences(transcription);
  }
}

/**
 * 解析 LLM 响应
 */
function parseLLMResponse(response: string): VideoSegment[] {
  try {
    // 去除可能的代码块标记
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.slice(7, -3).trim();
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.slice(3, -3).trim();
    }

    const parsed = JSON.parse(jsonStr);

    // 确保返回的是数组
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        start: typeof item.start === "number" ? item.start : parseFloat(item.start) || 0,
        end: typeof item.end === "number" ? item.end : parseFloat(item.end) || 0,
        summary: item.summary || item.desc || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
      }));
    }

    return [];
  } catch (error) {
    console.error("Failed to parse LLM response:", error);
    return [];
  }
}

/**
 * 按句子默认分段（当没有 LLM API Key 时使用）
 */
function segmentBySentences(transcription: TranscriptionSegment[]): LLMResult {
  const segments: VideoSegment[] = [];
  let currentSegment: VideoSegment | null = null;

  for (const seg of transcription) {
    if (!currentSegment) {
      currentSegment = {
        start: seg.start,
        end: seg.end,
        summary: seg.text,
        tags: [],
      };
    } else {
      // 如果当前片段时长超过30秒或者内容足够长，创建新片段
      const duration = seg.end - currentSegment.start;
      if (duration > 30 || currentSegment.summary.length > 100) {
        segments.push(currentSegment);
        currentSegment = {
          start: seg.start,
          end: seg.end,
          summary: seg.text,
          tags: [],
        };
      } else {
        currentSegment.end = seg.end;
        currentSegment.summary += " " + seg.text;
      }
    }
  }

  // 添加最后一个片段
  if (currentSegment) {
    segments.push(currentSegment);
  }

  return { segments };
}
