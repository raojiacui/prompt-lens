import axios from "axios";
import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";

// 时间轴片段
export interface VideoSegment {
  startTime: number; // 秒
  endTime: number;   // 秒
}

// 转场效果
export type TransitionType =
  | "none"
  | "fade"
  | "dissolve"
  | "wipe_left"
  | "wipe_right"
  | "slide_left"
  | "slide_right"
  | "zoom_in"
  | "blur";

// 调色预设
export type ColorGrade =
  | "none"
  | "vintage"
  | "cinematic"
  | "warm"
  | "cool"
  | "dramatic"
  | "fade";

// 剪辑指令
export interface EditInstruction {
  segments: VideoSegment[];        // 要保留的片段
  transitions: TransitionType[];   // 转场效果
  transitionDuration: number;      // 转场时长（秒）
  music?: {
    url?: string;                 // 音乐文件 URL
    name?: string;                 // 预设音乐名称
    volume: number;                // 音量 0-1
  };
  colorGrade: ColorGrade;         // 调色
  outputDuration?: number;        // 输出视频总时长
}

// 解析结果
export interface ParseResult {
  success: boolean;
  instruction?: EditInstruction;
  error?: string;
}

// API 配置
const API_CONFIGS = {
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4v-plus",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
    model: "gemini-2.0-flash-exp",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.1-8b-instruct",
  },
};

export type ApiProvider = "zhipu" | "gemini" | "openrouter";

/**
 * 获取用户的 API Key（优先从数据库读取，没有则从环境变量读取）
 */
async function getUserApiKey(
  userId: string,
  provider: ApiProvider
): Promise<string | null> {
  // 先从数据库读取
  const result = await db.query.userApiKeys.findFirst({
    where: eq(userApiKeys.userId, userId),
  });

  if (result && result.isActive) {
    // 解密 API Key（支持加密和未加密的旧数据）
    try {
      if (isValidEncryptedKey(result.apiKey)) {
        return decryptApiKey(result.apiKey);
      }
      // 兼容旧数据：未加密的明文
      return result.apiKey;
    } catch (error) {
      console.error(`[VideoEditor] Failed to decrypt API key for ${provider}:`, error);
    }
  }

  // 数据库没有，则从环境变量读取
  if (provider === "openrouter") {
    return process.env.OPENROUTER_API_KEY || null;
  } else if (provider === "zhipu") {
    return process.env.ZHIPU_API_KEY || null;
  } else if (provider === "gemini") {
    return process.env.GEMINI_API_KEY || null;
  }

  return null;
}

/**
 * 调用 AI 解析剪辑指令
 */
export async function parseEditInstruction(
  userId: string,
  prompt: string,
  videoDuration: number,
  provider: ApiProvider = "zhipu"
): Promise<ParseResult> {
  const apiKey = await getUserApiKey(userId, provider);

  if (!apiKey) {
    return {
      success: false,
      error: "未配置 API Key，请在设置中添加",
    };
  }

  const config = API_CONFIGS[provider];

  const systemPrompt = `你是一个视频剪辑助手。用户会给你一个剪辑描述，你需要解析并生成剪辑指令。

视频总时长: ${videoDuration} 秒

请根据用户描述生成剪辑指令。用户描述可能是：
- "把第0-5秒和第10-20秒拼接"
- "保留前10秒"
- "只取5-15秒这段"
- "加上淡入淡出转场"
- "配个欢快的音乐"
- "调成电影色调"

请用 JSON 格式返回，必须包含以下字段：
{
  "segments": [{"startTime": 0, "endTime": 5}, ...],  // 要保留的视频片段
  "transitions": ["fade", "none"],  // 转场效果数组，对应片段之间的转场
  "transitionDuration": 0.5,  // 转场时长（秒）
  "music": {"name": "欢快", "volume": 0.3},  // 音乐设置
  "colorGrade": "none"  // 调色: none/vintage/cinematic/warm/cool/dramatic/fade
}

支持的转场效果: none/fade/dissolve/wipe_left/wipe_right/slide_left/slide_right/zoom_in/blur
支持的调色: none/vintage/cinematic/warm/cool/dramatic/fade

如果用户没有指定具体时间，默认保留整个视频。
如果用户没有指定音乐，不返回 music 字段。
如果用户没有指定转场，默认用 fade。
如果用户没有指定调色，默认用 none。

只返回 JSON，不要其他内容。`;

  const userMessage = `视频总时长 ${videoDuration} 秒，我的剪辑需求是：${prompt}`;

  try {
    let response;

    if (provider === "zhipu") {
      response = await axios.post(
        config.url,
        {
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const content = response.data.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return { success: false, error: "AI 返回格式错误" };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return validateAndFixInstruction(parsed, videoDuration);
    } else if (provider === "gemini") {
      response = await axios.post(
        `${config.url}?key=${apiKey}`,
        {
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n${userMessage}` }],
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const content = response.data.candidates[0].content.parts[0].text;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return { success: false, error: "AI 返回格式错误" };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return validateAndFixInstruction(parsed, videoDuration);
    } else {
      // openrouter
      response = await axios.post(
        config.url,
        {
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Prompt Analyzer",
          },
        }
      );

      const content = response.data.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return { success: false, error: "AI 返回格式错误" };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return validateAndFixInstruction(parsed, videoDuration);
    }
  } catch (error: any) {
    console.error("AI 解析失败:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message || "AI 调用失败",
    };
  }
}

/**
 * 验证并修复指令
 */
function validateAndFixInstruction(
  parsed: any,
  videoDuration: number
): ParseResult {
  // 验证 segments
  const segments: VideoSegment[] = [];

  if (parsed.segments && Array.isArray(parsed.segments)) {
    for (const seg of parsed.segments) {
      const start = Math.max(0, parseFloat(seg.startTime) || 0);
      const end = Math.min(videoDuration, parseFloat(seg.endTime) || videoDuration);

      if (end > start) {
        segments.push({ startTime: start, endTime: end });
      }
    }
  }

  // 如果没有指定片段，默认整个视频
  if (segments.length === 0) {
    segments.push({ startTime: 0, endTime: videoDuration });
  }

  // 验证转场
  const validTransitions: TransitionType[] = [
    "none",
    "fade",
    "dissolve",
    "wipe_left",
    "wipe_right",
    "slide_left",
    "slide_right",
    "zoom_in",
    "blur",
  ];

  const transitions: TransitionType[] = [];

  if (parsed.transitions && Array.isArray(parsed.transitions)) {
    for (const t of parsed.transitions) {
      if (validTransitions.includes(t)) {
        transitions.push(t);
      } else {
        transitions.push("fade");
      }
    }
  }

  // 确保转场数组长度正确
  while (transitions.length < segments.length - 1) {
    transitions.push("fade");
  }

  // 验证调色
  const validGrades: ColorGrade[] = [
    "none",
    "vintage",
    "cinematic",
    "warm",
    "cool",
    "dramatic",
    "fade",
  ];

  const colorGrade: ColorGrade = validGrades.includes(parsed.colorGrade)
    ? parsed.colorGrade
    : "none";

  // 验证转场时长
  const transitionDuration = Math.max(
    0.1,
    Math.min(3, parseFloat(parsed.transitionDuration) || 0.5)
  );

  // 音乐
  const music = parsed.music
    ? {
        name: parsed.music.name || "",
        volume: Math.max(0, Math.min(1, parseFloat(parsed.music.volume) || 0.3)),
      }
    : undefined;

  return {
    success: true,
    instruction: {
      segments,
      transitions,
      transitionDuration,
      music,
      colorGrade,
    },
  };
}
