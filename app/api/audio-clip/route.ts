import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, videoClip, operationLogs } from "@/lib/db";
import { getFromR2, uploadToR2 } from "@/lib/cloudflare/r2";
import { cleanupTempFiles } from "@/lib/video-processor";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

// 设置 FFmpeg 路径 - 指向 win32-x64 目录
const ffmpegPath = path.join(
  process.cwd(),
  "node_modules",
  ".pnpm",
  "@ffmpeg-installer+win32-x64@4.1.0",
  "node_modules",
  "@ffmpeg-installer",
  "win32-x64",
  "ffmpeg.exe"
);
ffmpeg.setFfmpegPath(ffmpegPath);

interface ClipSegment {
  start: number;
  end: number;
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { mediaUrl, segments, outputFormat = "merge" } = body;

    if (!mediaUrl || !segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: "Missing mediaUrl or segments" },
        { status: 400 }
      );
    }

    // 创建临时目录
    tempDir = path.join(process.cwd(), "temp_video_clip", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });

    // 下载原始视频
    const videoPath = path.join(tempDir, "source.mp4");
    let videoBuffer: Buffer;

    // 判断是 R2 URL 还是直接 URL
    const r2PublicUrl = process.env.R2_PUBLIC_URL || "";
    if (mediaUrl.includes(r2PublicUrl) && r2PublicUrl) {
      // 从 R2 下载
      const key = mediaUrl.replace(`${r2PublicUrl}/`, "");
      videoBuffer = await getFromR2(key);
    } else {
      // 直接从 URL 下载
      console.log("Downloading video from URL:", mediaUrl);
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      videoBuffer = Buffer.from(arrayBuffer);
    }

    await fs.writeFile(videoPath, videoBuffer);

    console.log(`Video downloaded, starting clip processing. Segments: ${segments.length}`);

    const mediaName = mediaUrl.split("/").pop() || "unknown";
    const baseName = mediaName.replace(/\.[^/.]+$/, "");

    let outputVideoUrl: string;

    if (outputFormat === "merge") {
      // 合并所有片段为一个视频
      outputVideoUrl = await mergeSegments(videoPath, segments, tempDir, baseName);
    } else {
      // 导出为多个独立视频文件
      const clipUrls = await exportMultipleClips(videoPath, segments, tempDir, baseName);
      outputVideoUrl = clipUrls[0]; // 返回第一个
    }

    // 保存到数据库
    const clipRecord = await db.insert(videoClip).values({
      userId: session.user.id,
      sourceMediaUrl: mediaUrl,
      sourceMediaName: mediaName,
      clipMediaUrl: outputVideoUrl,
      segments: segments,
      status: "completed",
    }).returning();

    // 记录操作
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: "video_clip",
      resourceId: clipRecord[0].id,
      metadata: {
        mediaUrl,
        segmentCount: segments.length,
        outputFormat,
      },
    });

    return NextResponse.json({
      success: true,
      id: clipRecord[0].id,
      clipUrl: outputVideoUrl,
      segments: segments,
    });
  } catch (error: any) {
    console.error("Video clip error:", error);

    return NextResponse.json(
      { error: error.message || "Video clip failed" },
      { status: 500 }
    );
  } finally {
    // 清理临时文件
    if (tempDir) {
      await cleanupTempFiles(tempDir);
    }
  }
}

/**
 * 将多个片段合并为一个视频
 */
async function mergeSegments(
  videoPath: string,
  segments: ClipSegment[],
  outputDir: string,
  baseName: string
): Promise<string> {
  const outputPath = path.join(outputDir, `${baseName}_clip.mp4`);

  // 创建临时文件列表
  const tempClipsDir = path.join(outputDir, "clips");
  await fs.mkdir(tempClipsDir, { recursive: true });

  const clipPaths: string[] = [];

  // 提取每个片段
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const clipPath = path.join(tempClipsDir, `clip_${i}.mp4`);

    await extractClip(videoPath, seg.start, seg.end, clipPath);
    clipPaths.push(clipPath);
  }

  // 创建合并文件列表
  const listPath = path.join(outputDir, "clips.txt");
  const listContent = clipPaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(listPath, listContent);

  // 合并视频
  await mergeVideos(listPath, outputPath);

  // 上传到 R2
  const outputBuffer = await fs.readFile(outputPath);
  const outputKey = `clips/${randomUUID()}_${baseName}_clip.mp4`;
  const outputUrl = await uploadToR2(outputBuffer, outputKey, "video/mp4");

  return outputUrl;
}

/**
 * 导出多个独立视频文件
 */
async function exportMultipleClips(
  videoPath: string,
  segments: ClipSegment[],
  outputDir: string,
  baseName: string
): Promise<string[]> {
  const clipUrls: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const clipPath = path.join(outputDir, `clip_${i}.mp4`);

    await extractClip(videoPath, seg.start, seg.end, clipPath);

    // 上传到 R2
    const outputBuffer = await fs.readFile(clipPath);
    const outputKey = `clips/${randomUUID()}_${baseName}_clip_${i}.mp4`;
    const outputUrl = await uploadToR2(outputBuffer, outputKey, "video/mp4");

    clipUrls.push(outputUrl);
  }

  return clipUrls;
}

/**
 * 提取单个视频片段
 */
function extractClip(
  videoPath: string,
  start: number,
  end: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(start)
      .duration(end - start)
      .outputOptions([
        "-c:v", "libx264",
        "-c:a", "copy",
        "-avoid_negative_ts", "make_zero",
      ])
      .output(outputPath)
      .on("end", () => {
        console.log(`Clip extracted: ${outputPath}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("Clip extraction error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * 合并多个视频片段
 */
function mergeVideos(listPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions([
        "-c", "copy",
      ])
      .output(outputPath)
      .on("end", () => {
        console.log(`Videos merged: ${outputPath}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("Video merge error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * 获取用户的视频剪辑历史
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    const records = await db.query.videoClip.findMany({
      where: (videoClip, { eq }) => eq(videoClip.userId, session.user.id),
      orderBy: (videoClip, { desc }) => [desc(videoClip.createdAt)],
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      data: records,
    });
  } catch (error: any) {
    console.error("Get video clip error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get records" },
      { status: 500 }
    );
  }
}
