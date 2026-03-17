import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, audioAnalysis, operationLogs } from "@/lib/db";
import { extractAudio, cleanupTempAudio, getDefaultWhisperModel, WhisperModelSize } from "@/lib/audio-processor";
import { transcribeAudio, segmentWithLLM, LLMProvider } from "@/lib/audio-processor/llm-segmenter";
import { getFromR2, uploadToR2 } from "@/lib/cloudflare/r2";
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
      whisperModelSize,
      llmProvider = "deepseek",
      prompt,
    } = body;

    if (!mediaUrl) {
      return NextResponse.json(
        { error: "Missing mediaUrl" },
        { status: 400 }
      );
    }

    // 记录分析开始（忽略错误，不阻塞主流程）
    try {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "analysis.start",
        resourceType: "audio",
        metadata: {
          mediaUrl,
          whisperModelSize,
          llmProvider,
        },
      });
    } catch (logError) {
      console.warn("Failed to log analysis start:", logError);
    }

    // 创建临时目录
    tempDir = path.join(process.cwd(), "temp_audio_analysis", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });

    // 下载视频
    const videoPath = path.join(tempDir, "video.mp4");
    let videoBuffer: Buffer;

    // 判断 URL 类型
    const r2PublicUrl = process.env.R2_PUBLIC_URL || "";

    if (mediaUrl.startsWith("file://")) {
      // 本地文件路径
      const localPath = mediaUrl.replace("file://", "").replace(/\//g, "\\");
      console.log("Reading from local file:", localPath);
      videoBuffer = await fs.readFile(localPath);
    } else if (mediaUrl.includes(r2PublicUrl) && r2PublicUrl) {
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

    console.log("Video downloaded, starting audio extraction...");

    // 提取音频
    const { audioPath, duration } = await extractAudio(videoPath, tempDir);

    console.log("Audio extracted, starting transcription...");

    // Whisper 语音识别
    const modelSize: WhisperModelSize = whisperModelSize || getDefaultWhisperModel();
    const transcriptionResult = await transcribeAudio(audioPath, modelSize);

    console.log("Transcription completed, starting LLM segmentation...");

    // LLM 智能分段
    const llmResult = await segmentWithLLM(
      session.user.id,
      transcriptionResult.segments,
      llmProvider as LLMProvider,
      prompt
    );

    console.log("LLM segmentation completed, saving to database...");

    // 保存到数据库
    const mediaName = mediaUrl.split("/").pop() || "unknown";
    const audioAnalysisRecord = await db.insert(audioAnalysis).values({
      userId: session.user.id,
      mediaUrl,
      mediaName,
      language: transcriptionResult.language,
      transcription: transcriptionResult.segments,
      segments: llmResult.segments,
      duration: Math.round(duration),
      whisperModel: modelSize,
      prompt: prompt || null,
      status: "completed",
    }).returning();

    // 记录分析完成
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: "audio",
      resourceId: audioAnalysisRecord[0].id,
      metadata: {
        mediaUrl,
        segmentCount: llmResult.segments.length,
        language: transcriptionResult.language,
        duration: Math.round(duration),
      },
    });

    return NextResponse.json({
      success: true,
      id: audioAnalysisRecord[0].id,
      language: transcriptionResult.language,
      transcription: transcriptionResult.segments,
      segments: llmResult.segments,
      duration: Math.round(duration),
    });
  } catch (error: any) {
    console.error("Audio analysis error:", error);

    // 记录错误
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user) {
        await db.insert(operationLogs).values({
          userId: session.user.id,
          action: "analysis.error",
          resourceType: "audio",
          metadata: {
            error: error.message,
          },
        });
      }
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: error.message || "Audio analysis failed" },
      { status: 500 }
    );
  } finally {
    // 清理临时文件
    if (tempDir) {
      await cleanupTempAudio(tempDir);
    }
  }
}

/**
 * 获取用户的音频分析历史
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

    const records = await db.query.audioAnalysis.findMany({
      where: (audioAnalysis, { eq }) => eq(audioAnalysis.userId, session.user.id),
      orderBy: (audioAnalysis, { desc }) => [desc(audioAnalysis.createdAt)],
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      data: records,
    });
  } catch (error: any) {
    console.error("Get audio analysis error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get records" },
      { status: 500 }
    );
  }
}
