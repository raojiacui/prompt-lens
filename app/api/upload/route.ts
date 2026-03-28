import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  uploadToR2,
  generateUserFilePath,
  isAllowedFileType,
  isFileSizeValid,
  getSignedUrlFromR2,
} from "@/lib/cloudflare/r2";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { validateFile } from "@/lib/utils/file-validation";

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

    // 生成 B2 存储路径（强制使用 B2，不再回退本地存储）
    const mediaType = isVideo ? "video" : "image";
    const contentType = file.type || (isVideo ? "video/mp4" : "image/jpeg");

    // 强制使用 B2，不再检查配置
    const key = generateUserFilePath(session.user.id, file.name, mediaType);
    console.log("Uploading to B2, key:", key, "contentType:", contentType, "buffer size:", buffer.length);

    let url: string;
    try {
      // 先直接上传（不生成签名），验证上传是否成功
      console.log("Step 1: Uploading to B2...");
      await uploadToR2(buffer, key, contentType);
      console.log("Step 1 complete: Upload successful");

      // 生成签名 URL（1小时有效期）
      console.log("Step 2: Generating signed URL...");
      url = await getSignedUrlFromR2(key, 3600);
      console.log("Step 2 complete: Signed URL generated", url.substring(0, 50) + "...");
    } catch (b2Error) {
      console.error("B2 error:", b2Error);
      return NextResponse.json(
        { error: `B2 upload failed: ${b2Error instanceof Error ? b2Error.message : 'Unknown error'}` },
        { status: 500 }
      );
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
      key: key,
    };

    // 返回 key，便于后续分析 API 使用
    response.key = key;

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
