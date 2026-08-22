import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { getPresignedUploadUrl, getR2PublicUrl, uploadToR2 } from "@/lib/cloudflare/r2";

export const runtime = "nodejs";

const ALLOWED_VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"];
const ALLOWED_IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"];
const MAX_VIDEO_SIZE_MB = 500;
const MAX_IMAGE_SIZE_MB = 20;

type UploadMediaType = "video" | "image";

type RequestBody = {
  filename: string;
  contentType: string;
  size: number;
  mediaType: UploadMediaType;
};

function isAllowedFile(filename: string, mediaType: UploadMediaType) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const allowed = mediaType === "video" ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
  return allowed.includes(ext);
}

function maxSizeBytes(mediaType: UploadMediaType) {
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

function validateUploadPayload(body: RequestBody) {
  if (
    !body.filename ||
    !body.contentType ||
    typeof body.size !== "number" ||
    !Number.isFinite(body.size) ||
    (body.mediaType !== "video" && body.mediaType !== "image")
  ) {
    return "Invalid request body";
  }

  if (!isAllowedFile(body.filename, body.mediaType)) {
    return "Invalid file type";
  }

  if (body.size > maxSizeBytes(body.mediaType)) {
    const maxMb = body.mediaType === "video" ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;
    return `File too large. Max size: ${maxMb}MB`;
  }

  return null;
}

function createUploadKey(body: Pick<RequestBody, "filename" | "mediaType">) {
  return `uploads/${body.mediaType}/${crypto.randomUUID()}-${safeFilename(body.filename)}`;
}

async function handlePresignedUpload(body: RequestBody, userId: string) {
  const validationError = validateUploadPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const key = createUploadKey(body);
  const publicUrl = getR2PublicUrl(key);
  const presignedUrl = await getPresignedUploadUrl(key, body.contentType, 600);

  await db.insert(operationLogs).values({
    userId,
    action: "file.upload",
    resourceType: body.mediaType,
    metadata: {
      phase: "presigned",
      filename: body.filename,
      size: body.size,
      url: publicUrl,
      storage: "r2",
    },
  });

  return NextResponse.json({
    presignedUrl,
    publicUrl,
    key,
    mediaType: body.mediaType,
    storage: "r2",
  });
}

async function handleServerUpload(request: NextRequest, userId: string) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing upload file" }, { status: 400 });
  }

  const mediaType = formData.get("mediaType");
  const filename = String(formData.get("filename") || file.name || "upload");
  const contentType = String(formData.get("contentType") || file.type || "application/octet-stream");

  const body: RequestBody = {
    filename,
    contentType,
    size: file.size,
    mediaType: mediaType === "video" || mediaType === "image" ? mediaType : "video",
  };

  const validationError = validateUploadPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const key = createUploadKey(body);
  console.info("[upload-b2] Server fallback upload started", {
    filename: body.filename,
    mediaType: body.mediaType,
    size: body.size,
    contentType: body.contentType,
    key,
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const publicUrl = await uploadToR2(buffer, key, body.contentType);
  console.info("[upload-b2] Server fallback upload completed", { key, publicUrl });

  await db.insert(operationLogs).values({
    userId,
    action: "file.upload",
    resourceType: body.mediaType,
    metadata: {
      phase: "server-upload",
      filename: body.filename,
      size: body.size,
      url: publicUrl,
      storageKey: key,
      storage: "r2",
    },
  });

  return NextResponse.json({
    publicUrl,
    key,
    mediaType: body.mediaType,
    storage: "r2",
    fallback: "server-upload",
  });
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

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return handleServerUpload(request, session.user.id);
    }

    const body = (await request.json()) as RequestBody;
    return handlePresignedUpload(body, session.user.id);
  } catch (error) {
    console.error("R2 upload route error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
