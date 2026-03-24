import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { parseEditInstruction, ApiProvider } from "@/lib/ai/video-editor";
import { editVideo, getVideoInfo } from "@/lib/video-processor/editor";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    // 检查是否是 FormData（文件上传）
    const contentType = request.headers.get("content-type") || "";

    let videoPath: string;
    let prompt: string;
    let userId: string;

    if (contentType.includes("multipart/form-data")) {
      // 文件上传模式
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = session.user.id;

      // 速率限制检查
      const { allowed, resetIn } = checkRateLimit(
        userId,
        RateLimitConfigs.upload.limit,
        RateLimitConfigs.upload.windowMs
      );

      if (!allowed) {
        return NextResponse.json(
          { error: "请求过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) },
          { status: 429 }
        );
      }

      const formData = await request.formData();
      const file = formData.get("file") as File;
      prompt = formData.get("prompt") as string;

      if (!file || !prompt) {
        return NextResponse.json(
          { error: "Missing file or prompt" },
          { status: 400 }
        );
      }

      // 创建临时目录
      tempDir = path.join(process.cwd(), "temp_video_edit", randomUUID());
      await fs.mkdir(tempDir, { recursive: true });

      // 保存上传的文件
      const buffer = Buffer.from(await file.arrayBuffer());
      videoPath = path.join(tempDir, "input.mp4");
      await fs.writeFile(videoPath, buffer);
    } else {
      // JSON 模式（需要登录和 R2）
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = session.user.id;

      const body = await request.json();
      const { mediaUrl, prompt: jsonPrompt } = body;
      prompt = jsonPrompt;

      if (!mediaUrl || !prompt) {
        return NextResponse.json(
          { error: "Missing mediaUrl or prompt" },
          { status: 400 }
        );
      }

      // 创建临时目录
      tempDir = path.join(process.cwd(), "temp_video_edit", randomUUID());
      await fs.mkdir(tempDir, { recursive: true });

      // 这里暂时不支持从 R2 下载，除非配置了 R2
      // 简化处理：返回错误提示用户使用文件上传
      return NextResponse.json(
        { error: "请使用文件上传模式" },
        { status: 400 }
      );
    }

    // 获取视频信息
    const videoInfo = await getVideoInfo(videoPath);

    // 记录剪辑开始
    try {
      await db.insert(operationLogs).values({
        userId,
        action: "video.edit.start",
        resourceType: "video",
        metadata: { prompt, videoDuration: videoInfo.duration },
      });
    } catch (e) {
      // 忽略日志错误
    }

    // 调用 AI 解析剪辑指令
    const parseResult = await parseEditInstruction(
      userId,
      prompt,
      videoInfo.duration,
      "openrouter" as ApiProvider
    );

    if (!parseResult.success || !parseResult.instruction) {
      return NextResponse.json(
        { error: parseResult.error || "AI 解析失败" },
        { status: 400 }
      );
    }

    // 执行视频剪辑
    const editResult = await editVideo(
      videoPath,
      parseResult.instruction,
      userId,
      tempDir
    );

    if (!editResult.success) {
      return NextResponse.json(
        { error: editResult.error || "视频剪辑失败" },
        { status: 500 }
      );
    }

    // 返回结果（包含视频 URL 或 base64）
    return NextResponse.json({
      success: true,
      outputUrl: editResult.outputUrl,
      instruction: parseResult.instruction,
    });
  } catch (error: any) {
    console.error("Video edit error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  } finally {
    // 清理临时文件
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }
}
