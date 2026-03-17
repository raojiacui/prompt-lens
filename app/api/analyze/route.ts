import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory, operationLogs } from "@/lib/db";
import { analyzeFrames, ApiProvider } from "@/lib/ai/analyzer";
import { extractFrames, frameToBase64, cleanupTempFiles } from "@/lib/video-processor";
import { getFromR2 } from "@/lib/cloudflare/r2";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      mediaUrl,
      mediaType,
      frameCount = 8,
      analyzeMode = "single",
      provider = "zhipu",
    } = body;

    if (!mediaUrl || !mediaType) {
      return NextResponse.json(
        { error: "Missing mediaUrl or mediaType" },
        { status: 400 }
      );
    }

    // 记录分析开始
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.start",
      resourceType: mediaType,
      metadata: {
        mediaUrl,
        frameCount,
        analyzeMode,
        provider,
      },
    });

    // 创建临时目录
    tempDir = path.join(process.cwd(), "temp_analysis", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });

    let frames: string[] = [];

    if (mediaType === "video") {
      // 处理视频：下载 → 提取帧 → 转 base64
      const videoPath = path.join(tempDir, "video.mp4");

      let videoBuffer: Buffer;

      console.log("Processing video, mediaUrl:", mediaUrl);

      // 判断 URL 类型
      if (mediaUrl.startsWith("file://")) {
        // 本地文件路径
        const localPath = mediaUrl.replace("file://", "").replace(/\//g, "\\");
        console.log("Reading from local file:", localPath);
        videoBuffer = await fs.readFile(localPath);
      } else if (mediaUrl.includes("temp_uploads")) {
        // 本地临时文件（没有配置 R2 时）
        const localPath = path.join(process.cwd(), mediaUrl.replace(/.*\/temp_uploads\//, "temp_uploads\\"));
        console.log("Reading from temp_uploads:", localPath);
        videoBuffer = await fs.readFile(localPath);
      } else if (process.env.R2_PUBLIC_URL && mediaUrl.includes(process.env.R2_PUBLIC_URL)) {
        // 从 R2 下载
        const key = mediaUrl.replace(`${process.env.R2_PUBLIC_URL}/`, "");
        console.log("Reading from R2, key:", key);
        videoBuffer = await getFromR2(key);
      } else {
        // 直接从 URL 下载
        console.log("Downloading from URL:", mediaUrl);
        const response = await fetch(mediaUrl);
        const arrayBuffer = await response.arrayBuffer();
        videoBuffer = Buffer.from(arrayBuffer);
      }

      await fs.writeFile(videoPath, videoBuffer);
      console.log("Video saved to:", videoPath);

      // 提取帧
      console.log("Extracting frames...");
      const extractedFrames = await extractFrames(videoPath, frameCount, tempDir);
      console.log("Frames extracted:", extractedFrames.length);

      // 转 base64
      for (const frame of extractedFrames) {
        const base64 = await frameToBase64(frame.framePath);
        frames.push(base64);
      }
      console.log("Frames converted to base64, count:", frames.length);
    } else {
      // 处理图片：直接下载 → 转 base64
      let imageBuffer: Buffer;

      if (mediaUrl.startsWith("file://")) {
        // 本地文件路径
        const localPath = mediaUrl.replace("file://", "").replace(/\//g, "\\");
        imageBuffer = await fs.readFile(localPath);
      } else if (mediaUrl.includes("temp_uploads")) {
        // 本地临时文件
        const localPath = path.join(process.cwd(), mediaUrl.replace(/.*\/temp_uploads\//, "temp_uploads\\"));
        imageBuffer = await fs.readFile(localPath);
      } else if (process.env.R2_PUBLIC_URL && mediaUrl.includes(process.env.R2_PUBLIC_URL)) {
        // 从 R2 下载
        const key = mediaUrl.replace(`${process.env.R2_PUBLIC_URL}/`, "");
        imageBuffer = await getFromR2(key);
      } else {
        // 直接从 URL 下载
        const response = await fetch(mediaUrl);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      const base64 = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
      frames.push(base64);
    }

    console.log("Calling AI analysis...");
    // 调用 AI 分析
    const result = await analyzeFrames({
      userId: session.user.id,
      provider: provider as ApiProvider,
      frames,
      mode: analyzeMode as "single" | "batch",
    });

    if (!result.success) {
      // 记录分析错误
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "analysis.error",
        resourceType: mediaType,
        metadata: {
          error: result.error,
          mediaUrl,
        },
      });

      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // 保存到历史记录
    const historyRecord = await db.insert(analysisHistory).values({
      userId: session.user.id,
      mediaType,
      mediaUrl,
      mediaName: mediaUrl.split("/").pop(),
      frameCount: frames.length,
      analyzeMode,
      prompt: result.prompt!,
      corePrompt: result.corePrompt!,
    }).returning();

    // 记录分析完成
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: mediaType,
      resourceId: historyRecord[0].id,
      metadata: {
        mediaUrl,
        frameCount: frames.length,
        analyzeMode,
        provider,
      },
    });

    return NextResponse.json({
      success: true,
      prompt: result.prompt,
      corePrompt: result.corePrompt,
      historyId: historyRecord[0].id,
    });
  } catch (error: any) {
    console.error("Analyze error:", error);

    // 记录分析错误
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user) {
        await db.insert(operationLogs).values({
          userId: session.user.id,
          action: "analysis.error",
          metadata: {
            error: error.message,
          },
        });
      }
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: error.message || "Analysis failed" },
      { status: 500 }
    );
  } finally {
    // 清理临时文件
    if (tempDir) {
      await cleanupTempFiles(tempDir);
    }
  }
}
