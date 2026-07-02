import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import axios from "axios";

// 自托管 FFmpeg 服务的预期接口：
// POST {ffmpegServiceUrl}/edit
//   body: { videoUrl, instruction: { action, start, end, speed, segments, transition } }
//   returns: { url } (处理后的视频 URL)
//
// POST {ffmpegServiceUrl}/concat
//   body: { videoUrl, segments: [{start, end}] }
//   returns: { url }

interface EditInstruction {
  action: "trim" | "speed" | "concat" | "none";
  start?: number;
  end?: number;
  speed?: number;
  segments?: { start: number; end: number }[];
  transition?: string;
}

// 解析剪辑指令（用 LLM 把自然语言转成结构化指令）
async function parseEditInstruction(
  prompt: string,
  duration: number
): Promise<EditInstruction> {
  const llmApiKey = process.env.DEEPSEEK_API_KEY;
  if (!llmApiKey) {
    // 没有 LLM key 时，尝试简单解析
    return parseSimpleInstruction(prompt);
  }

  const systemPrompt = `你是一个专业的视频剪辑助手。用户给出剪辑指令，请解析为 JSON 格式。

支持的 action 类型：
- trim: 裁剪视频片段，需要 start 和 end（秒）
- concat: 拼接多个片段，需要 segments 数组（每个元素含 start 和 end）
- speed: 调整播放速度，需要 speed 数值（1=正常，2=2倍速）
- none: 无操作

可选字段：
- transition: 转场效果，如 "fade", "dissolve", "wipe"

示例输入：把前5秒和10-20秒拼接，加淡入淡出转场
示例输出：{"action":"concat","segments":[{"start":0,"end":5},{"start":10,"end":20}],"transition":"fade"}

示例输入：从第10秒到30秒
示例输出：{"action":"trim","start":10,"end":30}

只返回 JSON，不要其他内容。`;

  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `视频总时长 ${duration} 秒，剪辑指令：${prompt}` },
        ],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${llmApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const content = response.data.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { action: "none" };
  } catch (error) {
    console.error("LLM parsing error:", error);
    return parseSimpleInstruction(prompt);
  }
}

// 简单指令解析（无 LLM 时降级）
function parseSimpleInstruction(prompt: string): EditInstruction {
  // 尝试匹配 "X到Y秒" / "X-Y秒"
  const rangeMatch = prompt.match(/(\d+)\s*[到\-~]\s*(\d+)\s*秒/);
  if (rangeMatch) {
    return {
      action: "trim",
      start: parseInt(rangeMatch[1]),
      end: parseInt(rangeMatch[2]),
    };
  }
  // 尝试匹配 "前X秒"
  const frontMatch = prompt.match(/前\s*(\d+)\s*秒/);
  if (frontMatch) {
    return { action: "trim", start: 0, end: parseInt(frontMatch[1]) };
  }
  return { action: "none" };
}

export async function POST(request: NextRequest) {
  try {
    console.log("[video-edit] Request received");

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, resetIn } = checkRateLimit(
      session.user.id,
      RateLimitConfigs.analyze.limit,
      RateLimitConfigs.analyze.windowMs
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const videoUrl = body?.mediaUrl;
    const prompt: string = (body?.prompt || "").trim();
    const ffmpegServiceUrl: string = (body?.ffmpegServiceUrl || "").trim();

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing mediaUrl" }, { status: 400 });
    }
    if (!ffmpegServiceUrl) {
      return NextResponse.json(
        { error: "请先在设置中配置自托管 FFmpeg 服务地址" },
        { status: 400 }
      );
    }

    console.log("[video-edit] Processing:", { videoUrl: videoUrl.substring(0, 50), prompt, ffmpegServiceUrl });

    // 解析剪辑指令
    let instruction: EditInstruction = { action: "none" };
    if (prompt) {
      instruction = await parseEditInstruction(prompt, 60);
      console.log("[video-edit] Parsed instruction:", instruction);
    }

    // 如果没有剪辑指令，直接返回原视频
    if (instruction.action === "none") {
      return NextResponse.json({
        success: true,
        outputUrl: videoUrl,
        instruction,
        message: "无剪辑指令，返回原视频",
      });
    }

    // 调用自托管 FFmpeg 服务
    // 支持两种端点：/edit（单指令）或 /concat（多段拼接）
    let endpoint = "/edit";
    if (instruction.action === "concat" && instruction.segments) {
      endpoint = "/concat";
    }

    const ffmpegResponse = await axios.post(
      `${ffmpegServiceUrl.replace(/\/$/, "")}${endpoint}`,
      {
        videoUrl,
        instruction,
      },
      { timeout: 300000 } // 5 分钟超时，依赖自托管服务的处理能力
    );

    const outputUrl: string = ffmpegResponse.data?.url || ffmpegResponse.data?.outputUrl;
    if (!outputUrl) {
      throw new Error("FFmpeg 服务未返回结果 URL");
    }

    // 记录日志
    try {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "video.edit",
        resourceType: "video",
        metadata: {
          mediaUrl: videoUrl,
          prompt,
          instruction,
          outputUrl,
          ffmpegServiceUrl,
        },
      });
    } catch (logError) {
      console.warn("Failed to log video edit:", logError);
    }

    return NextResponse.json({
      success: true,
      outputUrl,
      instruction,
      message: "视频已剪辑完成",
    });
  } catch (error: any) {
    console.error("[video-edit] Error:", error);
    const message = error?.response?.data?.error || error?.message || "Video edit failed";
    const status = error?.response?.status || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
