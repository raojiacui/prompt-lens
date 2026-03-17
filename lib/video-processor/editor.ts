import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// 设置 FFmpeg 路径
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

// B2 配置（可选）
const b2Config = {
  region: process.env.B2_REGION || "us-west-000",
  accessKeyId: process.env.B2_ACCESS_KEY_ID,
  secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
  bucketName: process.env.B2_BUCKET_NAME || "prompt-analyzer",
  publicUrl: process.env.B2_PUBLIC_URL || "https://cdn.example.com",
};

// 仅在配置了 B2 时初始化 S3Client
const hasB2Config = b2Config.accessKeyId && b2Config.secretAccessKey;

let s3Client: S3Client | null = null;
if (hasB2Config) {
  s3Client = new S3Client({
    region: b2Config.region,
    endpoint: `https://s3.${b2Config.region}.backblazeb2.com`,
    credentials: {
      accessKeyId: b2Config.accessKeyId!,
      secretAccessKey: b2Config.secretAccessKey!,
    },
  });
}

// 预设音乐 URL（免费版权音乐）
const MUSIC_PRESETS: Record<string, string> = {
  欢快: "https://cdn.pixabay.com/audio/2022/10/25/audio_946a4375a2.mp3",
  舒缓: "https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf04a.mp3",
  浪漫: "https://cdn.pixabay.com/audio/2022/02/07/audio_5d1e33a6a0.mp3",
  紧张: "https://cdn.pixabay.com/audio/2021/08/04/audio_0625c1539c.mp3",
  悲伤: "https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73467.mp3",
};

export interface EditInstruction {
  segments: { startTime: number; endTime: number }[];
  transitions: string[];
  transitionDuration: number;
  music?: {
    url?: string;
    name?: string;
    volume: number;
  };
  colorGrade: string;
}

export interface VideoEditResult {
  success: boolean;
  outputUrl?: string;
  error?: string;
}

/**
 * 获取视频信息
 */
export async function getVideoInfo(videoPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> {
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
      });
    });
  });
}

/**
 * 下载音乐文件
 */
async function downloadMusic(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download music: ${response.statusText}`);
  }

  const stream = Readable.from(response.body as any);
  await pipeline(stream, fsSync.createWriteStream(outputPath));
}

/**
 * 应用调色
 */
function applyColorGrade(
  command: ffmpeg.FfmpegCommand,
  grade: string
): ffmpeg.FfmpegCommand {
  switch (grade) {
    case "vintage":
      // 复古色调 - 降低饱和度，稍微偏黄
      return command.videoFilter("eq=saturation=0.8:contrast=1.1:brightness=0.05:gamma=1.1");

    case "cinematic":
      // 电影色调 - 偏冷蓝色，提高对比度
      return command.videoFilter("eq=contrast=1.2:saturation=0.9:gamma=0.95,colorbalance=rs=-0.03:bs=0.05");

    case "warm":
      // 暖色调 - 偏黄橙色
      return command.videoFilter("colorbalance=rs=0.08:gs=0.03:bs=-0.05");

    case "cool":
      // 冷色调 - 偏蓝
      return command.videoFilter("colorbalance=rs=-0.05:bs=0.08");

    case "dramatic":
      // 戏剧性 - 高对比度，低饱和度
      return command.videoFilter("eq=contrast=1.4:saturation=0.7:gamma=0.9,colorbalance=rs=-0.02:gs=-0.02");

    case "fade":
      // 褪色效果
      return command.videoFilter("colorchannelmixer=0.3:0.3:0.3:0.3:0.3:0.3:0.3:0.3:0.3");

    default:
      return command;
  }
}

/**
 * 应用转场效果
 */
function applyTransition(
  inputFiles: string[],
  outputFile: string,
  transitions: string[],
  transitionDuration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 1. 先合并所有片段
    if (inputFiles.length === 1) {
      // 单个片段直接复制
      fs.copyFile(inputFiles[0], outputFile)
        .then(() => resolve())
        .catch(reject);
      return;
    }

    // 使用 concat demuxer 合并
    const concatListPath = path.join(
      path.dirname(outputFile),
      "concat.txt"
    );

    let concatContent = "";
    for (const file of inputFiles) {
      concatContent += `file '${file.replace(/\\/g, "/")}'\n`;
    }

    const mergedFile = path.join(
      path.dirname(outputFile),
      "merged_raw.mp4"
    );

    fs.writeFile(concatListPath, concatContent)
      .then(() => {
        ffmpeg()
          .input(concatListPath)
          .inputFormat("concat")
          .outputOptions(["-c", "copy"])
          .output(mergedFile)
          .on("end", async () => {
            // 2. 在合并后的视频上添加淡入淡出
            await new Promise<void>((res, rej) => {
              const totalDuration = inputFiles.length * 5; // 估算，每个片段约5秒
              ffmpeg(mergedFile)
                .videoFilter(
                  `fade=t=in:st=0:d=0.5,fade=t=out:st=${totalDuration - 0.5}:d=0.5`
                )
                .output(outputFile)
                .on("end", async () => {
                  try {
                    await fs.unlink(concatListPath);
                    await fs.unlink(mergedFile);
                  } catch (e) {}
                  res();
                })
                .on("error", rej)
                .run();
            });
            resolve();
          })
          .on("error", reject)
          .run();
      })
      .catch(reject);
  });
}

/**
 * 执行视频剪辑
 */
export async function editVideo(
  inputVideoPath: string,
  instruction: EditInstruction,
  userId: string,
  tempDir?: string
): Promise<VideoEditResult> {
  // 如果没有传入 tempDir，则创建一个
  if (!tempDir) {
    tempDir = path.join(process.cwd(), "temp_edit", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });
  }

  try {
    const outputFile = path.join(tempDir, "output.mp4");

    // 1. 提取需要的片段
    const segmentFiles: string[] = [];

    for (let i = 0; i < instruction.segments.length; i++) {
      const seg = instruction.segments[i];
      const segOutput = path.join(tempDir, `segment_${i}.mp4`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputVideoPath)
          .seekInput(seg.startTime)
          .duration(seg.endTime - seg.startTime)
          .output(segOutput)
          .on("end", () => {
            segmentFiles.push(segOutput);
            resolve();
          })
          .on("error", reject)
          .run();
      });
    }

    // 2. 合并片段（带转场）
    const mergedFile = path.join(tempDir, "merged.mp4");
    await applyTransition(
      segmentFiles,
      mergedFile,
      instruction.transitions,
      instruction.transitionDuration
    );

    // 3. 应用调色
    const colorFile = path.join(tempDir, "color.mp4");
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(mergedFile);
      command = applyColorGrade(command, instruction.colorGrade);
      command
        .output(colorFile)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    // 4. 添加音乐
    let finalFile = colorFile;
    if (instruction.music) {
      const musicUrl = instruction.music.url || MUSIC_PRESETS[instruction.music.name || ""];
      const musicPath = path.join(tempDir, "music.mp3");

      if (musicUrl && instruction.music) {
        await downloadMusic(musicUrl, musicPath);

        finalFile = path.join(tempDir, "final.mp4");
        await new Promise<void>((resolve, reject) => {
          ffmpeg(colorFile)
            .input(musicPath)
            .complexFilter([
              `[1:a]volume=${instruction.music!.volume}[music]`,
              `[0:a][music]amix=inputs=2:duration=first[aout]`,
            ])
            .outputOptions(["-map 0:v", "-map [aout]", "-shortest"])
            .output(finalFile)
            .on("end", () => resolve())
            .on("error", reject)
            .run();
        });
      }
    }

    // 5. 上传或返回本地路径
    const videoBuffer = await fs.readFile(finalFile);
    let outputUrl: string;

    if (hasB2Config && s3Client) {
      // 上传到 R2
      const outputKey = `users/${userId}/videos/${randomUUID()}_edited.mp4`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: b2Config.bucketName,
          Key: outputKey,
          Body: videoBuffer,
          ContentType: "video/mp4",
        })
      );

      outputUrl = `${b2Config.publicUrl}/${outputKey}`;
    } else {
      // 没有配置 R2，保存到 public 目录
      const outputDir = path.join(process.cwd(), "public", "edited");
      await fs.mkdir(outputDir, { recursive: true });

      const outputFileName = `${randomUUID()}_edited.mp4`;
      const outputPath = path.join(outputDir, outputFileName);

      await fs.writeFile(outputPath, videoBuffer);

      // 返回本地 URL
      outputUrl = `/edited/${outputFileName}`;
    }

    return {
      success: true,
      outputUrl,
    };
  } catch (error: any) {
    console.error("Video edit error:", error);
    return {
      success: false,
      error: error.message || "视频处理失败",
    };
  } finally {
    // 清理临时文件
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

/**
 * 获取支持的调色预设列表
 */
export function getColorGradePresets() {
  return [
    { id: "none", name: "原色", description: "不添加任何调色" },
    { id: "vintage", name: "复古", description: "怀旧风格，偏黄褪色" },
    { id: "cinematic", name: "电影感", description: "冷蓝调，高对比度" },
    { id: "warm", name: "暖色调", description: "温暖橙色氛围" },
    { id: "cool", name: "冷色调", description: "清新蓝色氛围" },
    { id: "dramatic", name: "戏剧性", description: "高对比度电影风格" },
    { id: "fade", name: "褪色", description: "低饱和度怀旧效果" },
  ];
}

/**
 * 获取支持的转场效果列表
 */
export function getTransitionPresets() {
  return [
    { id: "none", name: "直接切换", description: "无转场，直接跳转" },
    { id: "fade", name: "淡入淡出", description: "经典淡入淡出" },
    { id: "dissolve", name: "溶解", description: "平滑溶解过渡" },
    { id: "wipe_left", name: "左滑", description: "从左向右擦除" },
    { id: "wipe_right", name: "右滑", description: "从右向左擦除" },
    { id: "slide_left", name: "左滑入", description: "向左滑入" },
    { id: "slide_right", name: "右滑入", description: "向右滑入" },
    { id: "zoom_in", name: "缩放", description: "缩放过渡" },
    { id: "blur", name: "模糊", description: "模糊过渡" },
  ];
}

/**
 * 获取预设音乐列表
 */
export function getMusicPresets() {
  return [
    { id: "欢快", name: "欢快", description: "轻快活泼" },
    { id: "舒缓", name: "舒缓", description: "平静放松" },
    { id: "浪漫", name: "浪漫", description: "温馨浪漫" },
    { id: "紧张", name: "紧张", description: "悬疑紧张" },
    { id: "悲伤", name: "悲伤", description: "低沉忧伤" },
  ];
}
