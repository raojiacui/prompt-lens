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

export interface FrameExtractionResult {
  framePath: string;
  frameIndex: number;
  totalFrames: number;
  timestamp: number;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

/**
 * 获取视频信息
 */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === "video");

      if (!videoStream) {
        reject(new Error("No video stream found"));
        return;
      }

      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: Number(eval(videoStream.r_frame_rate || "30")) || 30,
        codec: videoStream.codec_name || "unknown",
      });
    });
  });
}

/**
 * 从视频中提取帧
 */
export async function extractFrames(
  videoPath: string,
  frameCount: number = 8,
  outputDir?: string
): Promise<FrameExtractionResult[]> {
  // 获取视频信息
  const videoInfo = await getVideoInfo(videoPath);

  // 创建输出目录
  if (!outputDir) {
    outputDir = path.join(process.cwd(), "temp_frames", randomUUID());
  }
  await fs.mkdir(outputDir, { recursive: true });

  // 计算提取时间点
  const interval = videoInfo.duration / (frameCount + 1);
  const timestamps: number[] = [];
  for (let i = 1; i <= frameCount; i++) {
    timestamps.push(interval * i);
  }

  const results: FrameExtractionResult[] = [];

  // 逐帧提取
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const outputPath = path.join(outputDir, `frame_${i.toString().padStart(3, "0")}.jpg`);

    await extractSingleFrame(videoPath, outputPath, timestamp);

    results.push({
      framePath: outputPath,
      frameIndex: i,
      totalFrames: frameCount,
      timestamp,
    });
  }

  return results;
}

/**
 * 提取单帧
 */
function extractSingleFrame(
  videoPath: string,
  outputPath: string,
  timestamp: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath)
      .outputOptions(["-q:v 2"]) // 高质量 JPEG
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

/**
 * 从 R2 URL 下载视频用于处理
 */
export async function downloadVideoForProcessing(
  r2Url: string,
  outputDir?: string
): Promise<string> {
  // 这里需要从 R2 下载文件
  // 简化实现：直接使用 URL（如果本地有的话）
  // 实际实现中，应该先下载到本地临时目录

  if (!outputDir) {
    outputDir = path.join(process.cwd(), "temp_downloads");
  }
  await fs.mkdir(outputDir, { recursive: true });

  const filename = r2Url.split("/").pop() || `${randomUUID()}.mp4`;
  const outputPath = path.join(outputDir, filename);

  // 实际实现需要使用 fetch 下载文件
  // const response = await fetch(r2Url);
  // const buffer = await response.arrayBuffer();
  // await fs.writeFile(outputPath, Buffer.from(buffer));

  return outputPath;
}

/**
 * 清理临时文件
 */
export async function cleanupTempFiles(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn("Failed to cleanup temp files:", error);
  }
}

/**
 * 将帧转换为 base64
 */
export async function frameToBase64(framePath: string): Promise<string> {
  const buffer = await fs.readFile(framePath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/**
 * 批量将帧转换为 base64
 */
export async function framesToBase64(
  frames: FrameExtractionResult[]
): Promise<string[]> {
  const base64Frames: string[] = [];

  for (const frame of frames) {
    const base64 = await frameToBase64(frame.framePath);
    base64Frames.push(base64);
  }

  return base64Frames;
}
