import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, audioAnalysis, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { AssemblyAI } from "assemblyai";
import axios from "axios";

// 初始化 AssemblyAI 客户端
function getAssemblyClient() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured");
  }
  return new AssemblyAI({
    apiKey,
    baseUrl: "https://api.assemblyai.com",
  });
}

// LLM 分段函数
async function segmentWithLLM(
  transcription: string,
  llmProvider: string,
  apiKey: string
): Promise<any[]> {
  const systemPrompt = `你是一个视频内容分析专家。用户提供语音转文字的字幕内容，你需要：
1. 将内容分成多个逻辑片段，每个片段代表一个独立的场景或话题
2. 为每个片段生成：
   - start: 起始时间（秒）
   - end: 结束时间（秒）
   - summary: 简短的中文摘要（1-2句话）
   - tags: 3-5个相关标签（英文单词，用逗号分隔）

请返回JSON格式的数组，示例：
[
  {"start": 0, "end": 15, "summary": "开场介绍项目背景", "tags": "intro,project,background"},
  {"start": 15, "end": 45, "summary": "讲解核心技术方案", "tags": "tech,solution,core"}
]

只返回JSON，不要其他内容。`;

  const userPrompt = `字幕内容：\n${transcription}`;

  try {
    // 使用 OpenRouter 或 Deepseek
    if (llmProvider === "deepseek" || llmProvider === "openrouter") {
      const baseUrl = llmProvider === "deepseek"
        ? "https://api.deepseek.com/v1"
        : "https://openrouter.ai/api/v1";
      const model = llmProvider === "deepseek" ? "deepseek-chat" : "anthropic/claude-3-haiku";

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        }
      );

      const content = response.data.choices[0]?.message?.content || "[]";
      // 提取 JSON 部分
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    // 默认返回空数组
    return [];
  } catch (error) {
    console.error("LLM segmentation error:", error);
    return [];
  }
}

// 解析时间字符串为秒数
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(":");
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(parts[0]);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 速率限制检查
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

    // 检查 AssemblyAI API Key
    if (!process.env.ASSEMBLYAI_API_KEY) {
      return NextResponse.json(
        { error: "AssemblyAI API key is not configured. Please add ASSEMBLYAI_API_KEY to environment variables." },
        { status: 500 }
      );
    }

    console.log("Starting AssemblyAI transcription for:", mediaUrl);

    // 记录分析开始
    try {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "analysis.start",
        resourceType: "audio",
        metadata: { mediaUrl, whisperModelSize, llmProvider },
      });
    } catch (logError) {
      console.warn("Failed to log analysis start:", logError);
    }

    // 使用 AssemblyAI 转录
    const client = getAssemblyClient();

    const transcript = await client.transcripts.transcribe({
      audio: mediaUrl,
      speaker_labels: true,
    });

    console.log("AssemblyAI transcription completed, status:", transcript.status);

    if (transcript.status === "error") {
      throw new Error(transcript.error || "Transcription failed");
    }

    // 等待转录完成（轮询）
    let finalTranscript = transcript;
    while (finalTranscript.status !== "completed" && finalTranscript.status !== "error") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const statusResponse = await client.transcripts.get(finalTranscript.id);
      finalTranscript = statusResponse;
      console.log("Transcription status:", finalTranscript.status);
    }

    if (finalTranscript.status === "error") {
      throw new Error(finalTranscript.error || "Transcription failed");
    }

    // 转换 AssemblyAI 结果为内部格式
    const transcriptionSegments = (finalTranscript.words || []).map((word: any) => ({
      start: word.start / 1000, // 转换为秒
      end: word.end / 1000,
      text: word.text,
      speaker: word.speaker || "unknown",
    }));

    // 合并文本用于 LLM 分析
    const fullText = (finalTranscript.words || [])
      .map((word: any) => word.text)
      .join(" ");

    console.log("Transcription text length:", fullText.length);

    // 使用 LLM 进行智能分段
    const llmApiKey = process.env.DEEPSEEK_API_KEY; // 需要配置 DeepSeek API Key
    let llmSegments: any[] = [];

    if (llmApiKey && (llmProvider === "deepseek" || llmProvider === "openrouter")) {
      try {
        llmSegments = await segmentWithLLM(fullText, llmProvider, llmApiKey);
      } catch (llmError) {
        console.warn("LLM segmentation failed, using simple segmentation:", llmError);
      }
    }

    // 如果 LLM 分段失败，使用简单的基于时间的分段
    if (llmSegments.length === 0 && transcriptionSegments.length > 0) {
      const duration = finalTranscript.audio_duration || 0;
      const segmentDuration = 30; // 每30秒一个片段
      let currentStart = 0;

      while (currentStart < duration) {
        const currentEnd = Math.min(currentStart + segmentDuration, duration);
        const segmentWords = transcriptionSegments.filter(
          (w) => w.start >= currentStart && w.end <= currentEnd
        );

        if (segmentWords.length > 0) {
          llmSegments.push({
            start: currentStart,
            end: currentEnd,
            summary: segmentWords.map((w) => w.text).join(" ").substring(0, 100),
            tags: "auto,segment",
          });
        }

        currentStart = currentEnd;
      }
    }

    // 保存到数据库
    const mediaName = mediaUrl.split("/").pop() || "unknown";
    const audioAnalysisRecord = await db.insert(audioAnalysis).values({
      userId: session.user.id,
      mediaUrl,
      mediaName,
      language: finalTranscript.language_code || "unknown",
      transcription: transcriptionSegments,
      segments: llmSegments,
      duration: Math.round(finalTranscript.audio_duration || 0),
      whisperModel: whisperModelSize || "assemblyai",
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
        segmentCount: llmSegments.length,
        language: finalTranscript.language_code,
        duration: Math.round(finalTranscript.audio_duration || 0),
      },
    });

    return NextResponse.json({
      success: true,
      id: audioAnalysisRecord[0].id,
      language: finalTranscript.language_code || "unknown",
      transcription: transcriptionSegments,
      segments: llmSegments,
      duration: Math.round(finalTranscript.audio_duration || 0),
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
          metadata: { error: error.message },
        });
      }
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: error.message || "Audio analysis failed" },
      { status: 500 }
    );
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