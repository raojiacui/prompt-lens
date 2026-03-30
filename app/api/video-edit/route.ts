import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import axios from "axios";

// Shotstack API 配置
const SHOTSTACK_API_URL = "https://api.shotstack.io/v1";
const SHOTSTACK_API_KEY_ID = process.env.SHOTSTACK_API_KEY_ID;
const SHOTSTACK_API_SECRET = process.env.SHOTSTACK_API_SECRET;

function getShotstackHeaders() {
  if (!SHOTSTACK_API_KEY_ID || !SHOTSTACK_API_SECRET) {
    throw new Error("Shotstack API keys are not configured");
  }
  return {
    "x-api-key": `${SHOTSTACK_API_KEY_ID}:${SHOTSTACK_API_SECRET}`,
    "Content-Type": "application/json"
  };
}

// 解析剪辑指令
async function parseEditInstruction(
  prompt: string,
  duration: number,
  llmApiKey: string
): Promise<any> {
  const systemPrompt = `你是一个专业的视频剪辑助手。用户给出一段剪辑指令，你需要解析并返回 JSON 格式的指令。

当前支持的指令格式：
- trim: 裁剪视频的一部分
- start: 裁剪开始时间（秒）
- end: 裁剪结束时间（秒）
- speed: 播放速度（1 = 正常，2 = 2倍速）

示例输入：只保留前5秒
示例输出：{"action": "trim", "start": 0, "end": 5}

示例输入：从第10秒到30秒
示例输出：{"action": "trim", "start": 10, "end": 30}

示例输入：加速2倍
示例输出：{"action": "speed", "speed": 2}

示例输入：裁剪中间部分，5到15秒
示例输出：{"action": "trim", "start": 5, "end": 15}

请返回 JSON 格式，不要有其他内容。`;

  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `视频总时长 ${duration} 秒，剪辑指令：${prompt}` }
        ],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${llmApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const content = response.data.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { action: "none" };
  } catch (error) {
    console.error("LLM parsing error:", error);
    return { action: "none" };
  }
}

// 使用 Shotstack 进行视频剪辑
async function editVideoWithShotstack(
  videoUrl: string,
  instruction: any
): Promise<any> {
  const headers = getShotstackHeaders();

  // 构建剪辑命令
  const clip: any = {
    asset: {
      type: "video",
      src: videoUrl
    },
    start: 0,
    length: instruction.end ? instruction.end - instruction.start : 10,
    position: 0
  };

  // 如果有裁剪设置
  if (instruction.action === "trim" && instruction.start !== undefined) {
    clip.start = instruction.start;
    if (instruction.end) {
      clip.length = instruction.end - instruction.start;
    }
  }

  // 如果有速度设置
  if (instruction.action === "speed" && instruction.speed) {
    clip.fit = "crop";
    clip.speed = instruction.speed;
  }

  const timeline: any = {
    background: "#000000",
    tracks: [
      {
        clips: [clip]
      }
    ]
  };

  const payload = {
    timeline,
    output: {
      format: "mp4",
      resolution: "1080p"
    }
  };

  console.log("[Shotstack] Sending edit request...");

  // 发送编辑任务
  const response = await axios.post(
    `${SHOTSTACK_API_URL}/render`,
    payload,
    { headers }
  );

  const renderId = response.data.response.id;
  console.log("[Shotstack] Render started, ID:", renderId);

  // 等待渲染完成
  let resultUrl = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const statusRes = await axios.get(
      `${SHOTSTACK_API_URL}/render/${renderId}`,
      { headers }
    );

    const status = statusRes.data.response.status;
    console.log("[Shotstack] Status:", status);

    if (status === "failed") {
      throw new Error("Shotstack render failed");
    }

    if (status === "done") {
      resultUrl = statusRes.data.response.url;
      break;
    }
  }

  if (!resultUrl) {
    throw new Error("Shotstack render timeout");
  }

  return resultUrl;
}

export async function POST(request: NextRequest) {
  try {
    console.log("[video-edit] Request received");

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

    // 检查 Shotstack 配置
    if (!SHOTSTACK_API_KEY_ID || !SHOTSTACK_API_SECRET) {
      return NextResponse.json(
        { error: "Shotstack is not configured. Please add SHOTSTACK_API_KEY_ID and SHOTSTACK_API_SECRET to environment variables." },
        { status: 500 }
      );
    }

    // 检查 content-type
    const contentType = request.headers.get("content-type") || "";
    console.log("[video-edit] Content-Type:", contentType);

    let videoUrl: string;
    let prompt: string;

    if (contentType.includes("multipart/form-data")) {
      // 文件上传模式
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const urlFromForm = formData.get("mediaUrl") as string | null;
      prompt = (formData.get("prompt") as string) || "";

      if (file && !urlFromForm) {
        // 需要先上传文件到 B2 获取 URL
        const { uploadToR2, generateUserFilePath } = await import("@/lib/cloudflare/r2");
        const buffer = Buffer.from(await file.arrayBuffer());
        const key = generateUserFilePath(session.user.id, file.name, "video");

        await uploadToR2(buffer, key, file.type || "video/mp4");
        videoUrl = `${process.env.B2_PUBLIC_URL}/${key}`;
        console.log("[video-edit] File uploaded to B2:", videoUrl);
      } else if (urlFromForm) {
        videoUrl = urlFromForm;
      } else {
        return NextResponse.json(
          { error: "Missing file or mediaUrl" },
          { status: 400 }
        );
      }
    } else {
      // JSON 模式
      const body = await request.json().catch((err) => {
        console.error("[video-edit] JSON parse error:", err);
        throw new Error("Invalid JSON in request body");
      });

      videoUrl = body.mediaUrl;
      prompt = body.prompt || "";

      if (!videoUrl) {
        return NextResponse.json(
          { error: "Missing mediaUrl" },
          { status: 400 }
        );
      }
    }

    console.log("[video-edit] Processing:", { videoUrl: videoUrl?.substring(0, 50), prompt });

    // 解析剪辑指令
    let instruction = { action: "upload" };
    if (prompt) {
      const llmApiKey = process.env.DEEPSEEK_API_KEY;
      if (llmApiKey) {
        instruction = await parseEditInstruction(prompt, 60, llmApiKey);
        console.log("[video-edit] Parsed instruction:", instruction);
      }
    }

    // 执行剪辑
    let outputUrl: string;
    if (instruction.action === "trim" || instruction.action === "speed" || instruction.action === "cut") {
      outputUrl = await editVideoWithShotstack(videoUrl, instruction);
      console.log("[video-edit] Edit complete, URL:", outputUrl);
    } else {
      // 没有剪辑指令，返回原视频 URL
      outputUrl = videoUrl;
      console.log("[video-edit] No edit needed, returning original URL");
    }

    return NextResponse.json({
      success: true,
      outputUrl,
      message: instruction.action === "none" ? "原视频" : "视频已剪辑完成"
    });
  } catch (error: any) {
    console.error("[video-edit] Error:", error);

    return NextResponse.json(
      { error: error.message || "Video edit failed" },
      { status: 500 }
    );
  }
}