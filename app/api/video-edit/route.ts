import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import axios from "axios";
import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import { callAIProvider } from "@/lib/ai/chat";

// 把 R2 公开 URL 转成签名 URL，让自托管 FFmpeg 服务能下载
async function ensureAccessibleUrl(url: string): Promise<string> {
  const r2Key = extractR2Key(url);
  if (r2Key) {
    try {
      return await getSignedUrlFromR2(r2Key, 7200); // 2 小时有效期
    } catch (err) {
      console.warn("Failed to generate signed URL:", err);
    }
  }
  return url;
}

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
  duration: number,
  userId: string,
): Promise<EditInstruction> {
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

  const content = await callAIProvider({
    userId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `视频总时长 ${duration} 秒，剪辑指令：${prompt}` },
    ],
  });
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("KIE did not return a video edit instruction");
  return JSON.parse(jsonMatch[0]) as EditInstruction;
}

export async function POST(request: NextRequest) {
  try {
    console.log("[video-edit] Request received");

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, resetIn } = await checkRateLimit(
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
    const ffmpegServiceUrl: string = (process.env.FFMPEG_WORKER_URL || "").trim();
    const ffmpegWorkerSecret = process.env.FFMPEG_WORKER_SECRET || "";

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing mediaUrl" }, { status: 400 });
    }

    if (!ffmpegServiceUrl || !ffmpegWorkerSecret) {
      return NextResponse.json({ error: "FFmpeg worker is not configured on the server" }, { status: 500 });
    }

    console.log("[video-edit] Processing:", { videoUrl: videoUrl.substring(0, 50), prompt, ffmpegServiceUrl: "server-configured" });

    // 把 R2 公开 URL 转成签名 URL，确保自托管 FFmpeg 服务能下载
    const accessibleVideoUrl = await ensureAccessibleUrl(videoUrl);

    // 解析剪辑指令
    let instruction: EditInstruction = { action: "none" };
    if (prompt) {
      instruction = await parseEditInstruction(prompt, 60, session.user.id);
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
        videoUrl: accessibleVideoUrl,
        instruction,
      },
      { timeout: 300000, headers: { Authorization: `Bearer ${ffmpegWorkerSecret}` } }
    );

    const outputUrl: string = ffmpegResponse.data?.url || ffmpegResponse.data?.outputUrl;
    if (!outputUrl) {
      throw new Error("FFmpeg 服务未返回结果 URL");
    }

    // 记录日志
    try {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "video.edit.complete",
        resourceType: "video",
        metadata: {
          mediaUrl: videoUrl,
          prompt,
          instruction,
          outputUrl,
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
