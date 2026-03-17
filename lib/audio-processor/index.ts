import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { TranscriptionSegment } from "./llm-segmenter";

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

export interface AudioExtractionResult {
  audioPath: string;
  duration: number;
}

export interface WhisperTranscription {
  language: string;
  segments: TranscriptionSegment[];
}

export type WhisperModelSize = "tiny" | "base" | "small" | "medium" | "large-v2" | "large-v3";

/**
 * 从视频中提取音频
 */
export async function extractAudio(videoPath: string, outputDir?: string): Promise<AudioExtractionResult> {
  if (!outputDir) {
    outputDir = path.join(process.cwd(), "temp_audio", randomUUID());
  }
  await fs.mkdir(outputDir, { recursive: true });

  const audioPath = path.join(outputDir, "audio.wav");

  // 获取视频时长
  const duration = await getVideoDuration(videoPath);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        "-vn", // 不处理视频
        "-acodec", "pcm_s16le", // PCM 格式
        "-ar", "16000", // 16kHz 采样率
        "-ac", "1", // 单声道
      ])
      .output(audioPath)
      .on("end", () => {
        console.log("Audio extraction completed:", audioPath);
        resolve({ audioPath, duration });
      })
      .on("error", (err) => {
        console.error("Audio extraction error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * 获取视频时长
 */
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * 清理临时音频文件
 */
export async function cleanupTempAudio(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn("Failed to cleanup temp audio files:", error);
  }
}

/**
 * 获取可用的 Whisper 模型大小列表
 */
export function getAvailableWhisperModels(): { value: WhisperModelSize; label: string; description: string }[] {
  return [
    { value: "tiny", label: "tiny", description: "最快，最不准确 (≈39MB)" },
    { value: "base", label: "base", description: "快速，准确度一般 (≈74MB)" },
    { value: "small", label: "small", description: "平衡，速度和准确度适中 (≈244MB)" },
    { value: "medium", label: "medium", description: "较慢，准确度较高 (≈769MB)" },
    { value: "large-v2", label: "large-v2", description: "慢，最准确 (≈1550MB)" },
    { value: "large-v3", label: "large-v3", description: "最慢，最高准确度 (≈1550MB)" },
  ];
}

/**
 * 获取默认的 Whisper 模型大小
 */
export function getDefaultWhisperModel(): WhisperModelSize {
  return "small";
}
