import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { getPresignedUploadUrl } from "@/lib/cloudflare/r2";

const ALLOWED_VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"];
const ALLOWED_IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"];
const MAX_VIDEO_SIZE_MB = 500; // B2 单文件上限 5GB，这里保守设 500MB
const MAX_IMAGE_SIZE_MB = 20;

type RequestBody = {
  filename: string;
  contentType: string;
  size: number;
  mediaType: "video" | "image";
};

function isAllowedFile(filename: string, mediaType: "video" | "image") {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const allowed = mediaType === "video" ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
  return allowed.includes(ext);
}

function maxSizeBytes(mediaType: "video" | "image") {
  const mb = mediaType === "video" ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;
  return mb * 1024 * 1024;
}

function safeFilename(filename: string) {
  const fallback = "upload";
  const sanitized = filename
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || fallback;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, resetIn } = checkRateLimit(
      session.user.id,
      RateLimitConfigs.upload.limit,
      RateLimitConfigs.upload.windowMs
    );
    if (!allowed) {
      return NextResponse.json(
        { error: `Too many uploads. Retry after ${Math.ceil(resetIn / 1000)}s` },
        { status: 429 }
      );
    }

    const body = (await request.json()) as RequestBody;
    if (
      !body.filename ||
      !body.contentType ||
      typeof body.size !== "number" ||
      (body.mediaType !== "video" && body.mediaType !== "image")
    ) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!isAllowedFile(body.filename, body.mediaType)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    if (body.size > maxSizeBytes(body.mediaType)) {
      const maxMb =
        body.mediaType === "video" ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;
      return NextResponse.json(
        { error: `File too large. Max size: ${maxMb}MB` },
        { status: 400 }
      );
    }

    const key = `uploads/${body.mediaType}/${crypto.randomUUID()}-${safeFilename(body.filename)}`;
    const publicUrl = `${process.env.B2_PUBLIC_URL}/${key}`;
    const presignedUrl = await getPresignedUploadUrl(key, body.contentType, 600); // 10 分钟有效期

    // 记录日志
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "file.upload",
      resourceType: body.mediaType,
      metadata: {
        filename: body.filename,
        size: body.size,
        url: publicUrl,
        storage: "b2",
      },
    });

    return NextResponse.json({
      presignedUrl,
      publicUrl,
      key,
      mediaType: body.mediaType,
    });
  } catch (error) {
    console.error("B2 upload route error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
