import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { put } from "@vercel/blob";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { isFileSizeValid } from "@/lib/cloudflare/r2";
import { randomUUID } from "crypto";

// 允许的文件类型和大小限制
const ALLOWED_VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"];
const ALLOWED_IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"];
const MAX_VIDEO_SIZE_MB = 200;
const MAX_IMAGE_SIZE_MB = 20;

// 生成用户文件路径
function generateUserFilePath(
  userId: string,
  filename: string,
  type: "video" | "image"
): string {
  const ext = filename.split(".").pop();
  const uniqueName = `${randomUUID()}.${ext}`;
  return `users/${userId}/${type}/${uniqueName}`;
}

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

    // 生成存储路径
    const mediaType = isVideo ? "video" : "image";
    const key = generateUserFilePath(session.user.id, file.name, mediaType);

    console.log("[upload] Uploading to Vercel Blob, key:", key);

    try {
      // 使用 Vercel Blob 上传（支持大文件流式上传）
      const blob = await put(key, file, {
        access: "public",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      console.log("[upload] Upload successful, url:", blob.url);

      // 记录操作日志
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "file.upload",
        resourceType: mediaType,
        metadata: {
          filename: file.name,
          size: file.size,
          url: blob.url,
        },
      });

      return NextResponse.json({
        success: true,
        url: blob.url,
        filename: file.name,
        mediaType,
        size: file.size,
        key: key,
      });
    } catch (blobError) {
      console.error("Blob error:", blobError);
      return NextResponse.json(
        { error: `Upload failed: ${blobError instanceof Error ? blobError.message : 'Unknown error'}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Upload error:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Upload failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// 获取上传 URL（保留兼容）
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: "GET upload is not supported, use POST to upload directly" },
    { status: 405 }
  );
}