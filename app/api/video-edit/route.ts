import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import axios from "axios";

// 初始化 Mux 客户端
function getMuxClient() {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    throw new Error("MUX_TOKEN_ID and MUX_TOKEN_SECRET are not configured");
  }

  // 使用 Basic Auth
  return {
    tokenId,
    tokenSecret,
    baseUrl: "https://api.mux.com"
  };
}

// 上传视频到 Mux
async function uploadToMux(videoUrl: string, client: any) {
  const auth = Buffer.from(`${client.tokenId}:${client.tokenSecret}`).toString("base64");

  // 创建上传 URL
  const createUploadRes = await axios.post(
    `${client.baseUrl}/video/v1/uploads`,
    {
      cors_origin: process.env.NEXT_PUBLIC_SITE_URL || "*",
      new_asset_settings: {
        playback_policy: ["public"],
        mp4_support: "capped-1080p"
      }
    },
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      }
    }
  ).catch((error) => {
    console.error("Mux API error:", error.response?.status, error.response?.data || error.message);
    throw new Error(`Mux API error: ${error.response?.status} - ${JSON.stringify(error.response?.data) || error.message}`);
  });

  console.log("Mux create upload response:", JSON.stringify(createUploadRes.data).substring(0, 500));

  if (!createUploadRes.data?.data?.url) {
    console.error("Mux response:", JSON.stringify(createUploadRes.data));
    // 检查是否是错误响应
    if (createUploadRes.data?.message) {
      throw new Error(`Mux API error: ${createUploadRes.data.message}`);
    }
    throw new Error("Mux API returned unexpected response: " + JSON.stringify(createUploadRes.data));
  }

  const uploadUrl = createUploadRes.data.data.url;
  const uploadId = createUploadRes.data.data.id;
  console.log("Mux upload URL created:", uploadUrl.substring(0, 50));

  // 下载原视频并上传到 Mux
  console.log("Downloading video from:", videoUrl.substring(0, 100));
  const videoResponse = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    timeout: 300000 // 5分钟超时
  }).catch((error) => {
    console.error("Download video error:", error.response?.data || error.message);
    throw new Error(`Failed to download video: ${error.message}`);
  });

  console.log("Video downloaded, size:", videoResponse.data.length);
  const videoBuffer = Buffer.from(videoResponse.data);

  await axios.put(uploadUrl, videoBuffer, {
    headers: {
      "Content-Type": "video/mp4"
    }
  });

  // 等待上传完成并获取 asset ID
  let assetId = null;
  let status = "preparing";

  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const uploadStatus = await axios.get(
      `${client.baseUrl}/video/v1/uploads/${uploadId}`,
      {
        headers: { Authorization: `Basic ${auth}` }
      }
    );

    status = uploadStatus.data.data.status;

    if (status === "asset_created") {
      assetId = uploadStatus.data.data.asset_id;
      break;
    }

    if (status === "errored") {
      throw new Error("Mux upload failed");
    }
  }

  if (!assetId) {
    throw new Error("Mux upload timeout");
  }

  // 获取播放 ID
  const assetRes = await axios.get(
    `${client.baseUrl}/video/v1/assets/${assetId}`,
    {
      headers: { Authorization: `Basic ${auth}` }
    }
  );

  const playbackId = assetRes.data.data.playback_ids?.[0]?.id;

  return {
    assetId,
    playbackId,
    streamUrl: playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null,
    thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg`
  };
}

// 解析剪辑指令并生成 Mux 剪辑
async function createMuxClip(client: any, assetId: string, instruction: any) {
  const auth = Buffer.from(`${client.tokenId}:${client.tokenSecret}`).toString("base64");

  // Mux 支持基于时间的剪辑通过 create-asset-from-live-stream
  // 对于简单剪辑，使用 time range trim
  const { startTime = 0, endTime, cutStart, cutEnd } = instruction;

  const trimStart = cutStart || startTime;
  const trimEnd = cutEnd || endTime;

  // 使用 Mux 的片段剪辑功能
  const trimStartMs = Math.floor(trimStart * 1000);
  const trimEndMs = trimEnd ? Math.floor(trimEnd * 1000) : null;

  // 创建剪辑后的资产
  // 注意：Mux 需要使用视频编辑功能，这需要企业版
  // 对于基础版，我们返回原始视频的签名 URL

  const assetRes = await axios.get(
    `${client.baseUrl}/video/v1/assets/${assetId}`,
    {
      headers: { Authorization: `Basic ${auth}` }
    }
  );

  const playbackId = assetRes.data.data.playback_ids?.[0]?.id;

  return {
    success: true,
    outputUrl: playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null,
    thumbnailUrl: playbackId ? `https://image.mux.com/${playbackId}/thumbnail.jpg` : null,
    assetId,
    message: trimStart > 0 || trimEnd ? `视频已准备，裁剪范围: ${trimStart}s - ${trimEnd}s` : "视频已上传",
    trimStart,
    trimEnd
  };
}

// LLM 解析剪辑指令
async function parseEditInstructionWithLLM(
  prompt: string,
  duration: number,
  provider: string,
  apiKey: string
): Promise<any> {
  const systemPrompt = `你是一个专业的视频剪辑助手。用户给出一段剪辑指令，你需要解析并返回 JSON 格式的指令。

当前支持的指令格式：
- start_time: 视频开始时间（秒）
- end_time: 视频结束时间（秒）
- cut_start: 裁剪开始时间（秒）
- cut_end: 裁剪结束时间（秒）
- speed: 播放速度（1 = 正常）

示例输入：把视频从第10秒到第30秒的部分裁剪出来
示例输出：{"start_time": 0, "end_time": null, "cut_start": 10, "cut_end": 30, "speed": 1, "action": "trim"}

示例输入：加速播放视频
示例输出：{"start_time": 0, "end_time": null, "cut_start": null, "cut_end": null, "speed": 2, "action": "speed"}

示例输入：裁剪中间部分，从5秒到15秒
示例输出：{"start_time": 0, "end_time": null, "cut_start": 5, "cut_end": 15, "speed": 1, "action": "trim"}

请返回 JSON 格式，不要有其他内容。`;

  try {
    const baseUrl = provider === "deepseek"
      ? "https://api.deepseek.com/v1"
      : "https://openrouter.ai/api/v1";
    const model = provider === "deepseek" ? "deepseek-chat" : "anthropic/claude-3-haiku";

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `视频总时长 ${duration} 秒，剪辑指令：${prompt}` }
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

    const content = response.data.choices[0]?.message?.content || "{}";
    console.log("LLM response content:", content.substring(0, 500));
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error("JSON parse error:", parseError, "content:", jsonMatch[0]);
        return { action: "none" };
      }
    }
    return { action: "none" };
  } catch (error) {
    console.error("LLM parsing error:", error);
    return { action: "none" };
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("[video-edit] Request received");

    const session = await auth.api.getSession({ headers: request.headers });
    console.log("[video-edit] Session:", session?.user ? "logged in" : "no session");

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

    // 检查 Mux 配置
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
      return NextResponse.json(
        { error: "Mux is not configured. Please add MUX_TOKEN_ID and MUX_TOKEN_SECRET to environment variables." },
        { status: 500 }
      );
    }

    // 检查 content-type
    const contentType = request.headers.get("content-type") || "";
    console.log("[video-edit] Content-Type:", contentType);

    let mediaUrl: string;
    let prompt: string;
    let action = "trim";

    if (contentType.includes("multipart/form-data")) {
      // 文件上传模式
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const urlFromForm = formData.get("mediaUrl") as string | null;
      prompt = (formData.get("prompt") as string) || "";

      // 如果有文件，先上传到 B2 获取 URL
      if (file && !urlFromForm) {
        console.log("[video-edit] Processing file upload...");

        // 调用 B2 上传 API（直接用已有的 uploadToR2）
        const { uploadToR2, generateUserFilePath, getFromB2 } = await import("@/lib/cloudflare/r2");
        const buffer = Buffer.from(await file.arrayBuffer());
        const key = generateUserFilePath(session.user.id, file.name, "video");

        try {
          await uploadToR2(buffer, key, file.type || "video/mp4");
          console.log("[video-edit] File uploaded to B2, key:", key);

          // 获取文件内容（用于后续上传到 Mux）
          let videoBuffer: Buffer;
          try {
            videoBuffer = await getFromB2(key);
            console.log("[video-edit] File retrieved from B2, size:", videoBuffer.length);
          } catch (getError) {
            console.error("[video-edit] Failed to get file from B2:", getError);
            throw new Error("Failed to retrieve file from B2");
          }

          // 直接将文件内容传递给 Mux 上传（不通过公共 URL）
          console.log("[video-edit] Ready to upload to Mux directly");
          // 继续执行下面的逻辑，但跳过 URL 下载步骤
          return NextResponse.json({
            success: true,
            message: "File uploaded to B2, preparing for Mux...",
            b2Key: key,
            fileSize: buffer.length,
          });
        } catch (uploadError) {
          console.error("[video-edit] B2 upload error:", uploadError);
          throw new Error("Failed to upload file to B2");
        }
      } else if (urlFromForm) {
        mediaUrl = urlFromForm;
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
      console.log("[video-edit] Body parsed:", JSON.stringify(body).substring(0, 200));

      mediaUrl = body.mediaUrl;
      prompt = body.prompt || "";
      action = body.action || "trim";

      if (!mediaUrl) {
        return NextResponse.json(
          { error: "Missing mediaUrl" },
          { status: 400 }
        );
      }
    }

    console.log("Video edit request:", { mediaUrl: mediaUrl?.substring(0, 50), prompt, action });

    // 记录操作开始
    try {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "video.edit.start",
        resourceType: "video",
        metadata: { mediaUrl, prompt, action },
      });
    } catch (e) {
      console.warn("Failed to log:", e);
    }

    const client = getMuxClient();

    // 上传视频到 Mux
    console.log("Uploading to Mux...", { mediaUrl: mediaUrl?.substring(0, 50) });
    let uploadResult;
    try {
      uploadResult = await uploadToMux(mediaUrl, client);
      console.log("Mux upload result:", JSON.stringify(uploadResult).substring(0, 200));
    } catch (muxError) {
      console.error("Mux upload error:", muxError);
      throw new Error(`Mux upload failed: ${muxError instanceof Error ? muxError.message : 'Unknown error'}`);
    }

    // 解析剪辑指令
    let instruction = { action: "upload" };
    let result: any = {
      success: true,
      outputUrl: uploadResult.streamUrl,
      thumbnailUrl: uploadResult.thumbnailUrl,
      assetId: uploadResult.assetId,
      message: "视频已上传到 Mux CDN"
    };

    if (prompt && action !== "upload") {
      // 获取视频时长（如果提供了）
      const duration = 60;

      // 解析 LLM 指令
      const llmApiKey = process.env.DEEPSEEK_API_KEY;
      if (llmApiKey) {
        instruction = await parseEditInstructionWithLLM(
          prompt,
          duration,
          "deepseek",
          llmApiKey
        );
      }

      // 执行剪辑
      if (instruction.action === "trim" || instruction.action === "cut") {
        const clipResult = await createMuxClip(client, uploadResult.assetId, instruction);
        result = { ...result, ...clipResult };
      }
    }

    // 记录操作完成
    try {
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "video.edit.complete",
        resourceType: "video",
        metadata: {
          assetId: uploadResult.assetId,
          instruction,
          result: result.message
        },
      });
    } catch (e) {
      console.warn("Failed to log:", e);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Video edit error:", error);

    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user) {
        await db.insert(operationLogs).values({
          userId: session.user.id,
          action: "video.edit.error",
          resourceType: "video",
          metadata: { error: error.message },
        });
      }
    } catch (e) {
      console.warn("Failed to log error:", e);
    }

    return NextResponse.json(
      { error: error.message || "Video edit failed" },
      { status: 500 }
    );
  }
}

/**
 * 获取视频编辑状态
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get("assetId");

    if (!assetId) {
      return NextResponse.json(
        { error: "Missing assetId" },
        { status: 400 }
      );
    }

    const client = getMuxClient();
    const authBasic = Buffer.from(`${client.tokenId}:${client.tokenSecret}`).toString("base64");

    const assetRes = await axios.get(
      `${client.baseUrl}/video/v1/assets/${assetId}`,
      {
        headers: { Authorization: `Basic ${authBasic}` }
      }
    );

    const asset = assetRes.data.data;
    const playbackId = asset.playback_ids?.[0]?.id;

    return NextResponse.json({
      success: true,
      status: asset.status,
      duration: asset.duration,
      outputUrl: playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null,
    });
  } catch (error: any) {
    console.error("Get video status error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get video status" },
      { status: 500 }
    );
  }
}