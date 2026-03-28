import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory, operationLogs } from "@/lib/db";
import { analyzeFrames, ApiProvider } from "@/lib/ai/analyzer";
import { extractFrames, frameToBase64, cleanupTempFiles } from "@/lib/video-processor";
import { getFromR2 } from "@/lib/cloudflare/r2";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
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

    // 速率限制检查 - 使用用户 ID 作为标识符
    const userId = session.user.id;
    const { allowed, remaining, resetIn } = checkRateLimit(
      userId,
      RateLimitConfigs.analyze.limit,
      RateLimitConfigs.analyze.windowMs
    );

    if (!allowed) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: Math.ceil(resetIn / 1000),
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(resetIn / 1000)),
            "Retry-After": String(Math.ceil(resetIn / 1000)),
          },
        }
      );
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

      console.log("Processing video, mediaUrl:", mediaUrl);

      // 判断 URL 类型 - 支持 B2 签名 URL 或带 B2_PUBLIC_URL 的 URL
      let videoBuffer: Buffer;

      // 从签名 URL 或普通 URL 中提取 B2 key
      const extractB2Key = (url: string): string | null => {
        // 匹配格式: https://s3.{region}.backblazeb2.com/{bucket}/{key}
        const s3Match = url.match(/s3\.[a-z0-9-]+\.backblazeb2\.com\/[^/]+\/(.+)$/);
        if (s3Match) return s3Match[1];

        // 匹配格式: {B2_PUBLIC_URL}/{key}
        if (process.env.B2_PUBLIC_URL) {
          const publicUrlMatch = url.match(`${process.env.B2_PUBLIC_URL}/(.+)$`);
          if (publicUrlMatch) return publicUrlMatch[1];
        }

        // 匹配 B2 公共域名格式: https://f001.backblazeb2.com/file/{bucket}/{key}
        const b2FileMatch = url.match(/f\d{3}\.backblazeb2\.com\/file\/[^/]+\/(.+)$/);
        if (b2FileMatch) return b2FileMatch[1];

        return null;
      };

      const b2Key = extractB2Key(mediaUrl);
      if (b2Key) {
        console.log("Reading from B2, key:", b2Key);
        videoBuffer = await getFromR2(b2Key);
      } else {
        // 直接从 URL 下载
        console.log("Downloading from URL:", mediaUrl);
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to download video: ${response.status}`);
        }
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

      // 判断 URL 类型 - 支持 B2 签名 URL 或带 B2_PUBLIC_URL 的 URL
      const extractB2Key = (url: string): string | null => {
        // 匹配格式: https://s3.{region}.backblazeb2.com/{bucket}/{key}
        const s3Match = url.match(/s3\.[a-z0-9-]+\.backblazeb2\.com\/[^/]+\/(.+)$/);
        if (s3Match) return s3Match[1];

        // 匹配格式: {B2_PUBLIC_URL}/{key}
        if (process.env.B2_PUBLIC_URL) {
          const publicUrlMatch = url.match(`${process.env.B2_PUBLIC_URL}/(.+)$`);
          if (publicUrlMatch) return publicUrlMatch[1];
        }

        // 匹配 B2 公共域名格式: https://f001.backblazeb2.com/file/{bucket}/{key}
        const b2FileMatch = url.match(/f\d{3}\.backblazeb2\.com\/file\/[^/]+\/(.+)$/);
        if (b2FileMatch) return b2FileMatch[1];

        return null;
      };

      let imageBuffer: Buffer;
      const imageB2Key = extractB2Key(mediaUrl);
      if (imageB2Key) {
        console.log("Reading image from B2, key:", imageB2Key);
        imageBuffer = await getFromR2(imageB2Key);
      } else {
        // 直接从 URL 下载
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.status}`);
        }
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
