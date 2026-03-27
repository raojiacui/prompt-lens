import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  uploadToR2,
  generateUserFilePath,
  isAllowedFileType,
  isFileSizeValid,
} from "@/lib/cloudflare/r2";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { validateFile } from "@/lib/utils/file-validation";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

// 允许的文件类型和大小限制
const ALLOWED_VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"];
const ALLOWED_IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"];
const MAX_VIDEO_SIZE_MB = 200;
const MAX_IMAGE_SIZE_MB = 20;

export async function POST(request: NextRequest) {
  console.log("[upload] Request received");
  try {
    console.log("[upload] Getting session...");
    const session = await auth.api.getSession({ headers: request.headers });
    console.log("[upload] Session:", session?.user ? "logged in" : "no session");

    if (!session?.user) {
      console.log("[upload] Unauthorized, returning 401");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 速率限制检查
    console.log("[upload] Checking rate limit...");
    const { allowed, resetIn } = checkRateLimit(
      session.user.id,
      RateLimitConfigs.upload.limit,
      RateLimitConfigs.upload.windowMs
    );

    if (!allowed) {
      console.log("[upload] Rate limited, returning 429");
      return NextResponse.json(
        { error: "上传过于频繁，请稍后再试", retryAfter: Math.ceil(resetIn / 1000) },
        { status: 429 }
      );
    }

    console.log("[upload] Parsing form data...");
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      console.log("[upload] No file provided, returning 400");
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log("[upload] File:", file.name, file.size, file.type);

    // 确定文件类型
    const filename = file.name.toLowerCase();
    const isVideo = ALLOWED_VIDEO_TYPES.some((ext) => filename.endsWith(`.${ext}`));
    const isImage = ALLOWED_IMAGE_TYPES.some((ext) => filename.endsWith(`.${ext}`));
    console.log("[upload] File type check:", { isVideo, isImage });

    if (!isVideo && !isImage) {
      console.log("[upload] Invalid file type, returning 400");
      return NextResponse.json(
        { error: "Invalid file type. Allowed: mp4, mov, avi, mkv, webm, jpg, jpeg, png, webp" },
        { status: 400 }
      );
    }

    // 检查文件大小
    const maxSize = isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;
    console.log("[upload] Size check:", { fileSize: file.size, maxSizeMB: maxSize });
    if (!isFileSizeValid(file.size, maxSize)) {
      console.log("[upload] File too large, returning 400");
      return NextResponse.json(
        { error: `File too large. Max size: ${maxSize}MB` },
        { status: 400 }
      );
    }

    // 读取文件内容用于验证
    console.log("[upload] Reading file buffer...");
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log("[upload] Buffer size:", buffer.length);

    // 临时禁用 Magic Number 验证（如果遇到问题可以重新启用）
    // 验证文件 Magic Number（防止扩展名伪造）
    // const validation = validateFile(file.name, buffer);
    // console.log("[upload] Magic number validation:", validation);
    // if (!validation.valid) {
    //   console.log("[upload] Magic number failed, returning 400");
    //   return NextResponse.json(
    //     { error: validation.error },
    //     { status: 400 }
    //   );
    // }

    // 生成 R2 存储路径
    const mediaType = isVideo ? "video" : "image";

    // 获取 Content-Type
    const contentType = file.type || (isVideo ? "video/mp4" : "image/jpeg");

    // 检查 B2 是否配置（必须三个都有值才算配置）
    const b2Configured = !!(process.env.B2_ACCESS_KEY_ID && process.env.B2_SECRET_ACCESS_KEY && process.env.B2_BUCKET_NAME);
    console.log("B2 config check:", {
      hasKey: !!process.env.B2_ACCESS_KEY_ID,
      hasSecret: !!process.env.B2_SECRET_ACCESS_KEY,
      hasBucket: !!process.env.B2_BUCKET_NAME,
      b2Configured
    });

    let url: string;
    let key: string | undefined;

    if (b2Configured) {
      // B2 已配置，上传到 B2
      key = generateUserFilePath(session.user.id, file.name, mediaType);
      console.log("Uploading to B2, key:", key);
      try {
        url = await uploadToR2(buffer, key, contentType);
        console.log("B2 upload success, url:", url);
      } catch (b2Error) {
        console.error("B2 upload failed:", b2Error);
        return NextResponse.json(
          { error: `B2 upload failed: ${b2Error instanceof Error ? b2Error.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    } else {
      // R2 未配置，保存到本地临时目录
      const tempDir = path.join(process.cwd(), "temp_uploads", session.user.id);
      await fs.mkdir(tempDir, { recursive: true });

      const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
      const tempFileName = `${randomUUID()}.${ext}`;
      const tempFilePath = path.join(tempDir, tempFileName);

      await fs.writeFile(tempFilePath, buffer);
      // 返回 file:// URL 格式，让音频分析 API 可以识别
      url = `file://${tempFilePath.replace(/\\/g, "/")}`;

      console.log("R2 not configured, saved to local temp:", tempFilePath);
    }

    // 记录操作日志
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "file.upload",
      resourceType: mediaType,
      metadata: {
        filename: file.name,
        size: file.size,
        url: url,
      },
    });

    const response: any = {
      success: true,
      url,
      filename: file.name,
      mediaType,
      size: file.size,
    };

    if (!b2Configured) {
      response.isLocal = true;
    } else {
      response.key = key;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Upload error:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Upload failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// 获取上传 URL（用于大文件分片上传）
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");
    const mediaType = searchParams.get("type") as "video" | "image";

    if (!filename || !mediaType) {
      return NextResponse.json(
        { error: "Missing filename or type" },
        { status: 400 }
      );
    }

    // 验证文件类型
    if (!isAllowedFileType(filename, [mediaType])) {
      return NextResponse.json(
        { error: "Invalid file type" },
        { status: 400 }
      );
    }

    // 生成预签名的上传 URL（这里简化为直接返回路径）
    const key = generateUserFilePath(session.user.id, filename, mediaType);

    return NextResponse.json({
      key,
      uploadUrl: `${process.env.B2_PUBLIC_URL}/${key}`,
    });
  } catch (error) {
    console.error("Get upload URL error:", error);
    return NextResponse.json(
      { error: "Failed to get upload URL" },
      { status: 500 }
    );
  }
}
