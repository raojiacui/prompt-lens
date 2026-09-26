import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";
import { getPresignedUploadUrl, getR2PublicUrl } from "@/lib/cloudflare/r2";
import { db, operationLogs } from "@/lib/db";
import { UPLOAD_MAX_BYTES, validUploadSize } from "@/lib/media-upload-policy";

export const runtime = "nodejs";

const ALLOWED_VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"];
const ALLOWED_IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"];

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
    !body || typeof body.filename !== "string" || !body.filename ||
    typeof body.contentType !== "string" || !body.contentType ||
    typeof body.size !== "number" ||
    !Number.isFinite(body.size) ||
    (body.mediaType !== "video" && body.mediaType !== "image")
  ) {
    return "Invalid request body";
  }

  if (!isAllowedFile(body.filename, body.mediaType)) {
    return "Invalid file type";
  }

  if (!validUploadSize(body.size, body.mediaType)) {
    const maxMb = UPLOAD_MAX_BYTES[body.mediaType] / 1024 / 1024;
    return `File too large. Max size: ${maxMb}MB`;
  }

  return null;
}

function createUploadKey(body: Pick<RequestBody, "filename" | "mediaType">, userId: string) {
  return `uploads/${userId}/${body.mediaType}/${crypto.randomUUID()}-${safeFilename(body.filename)}`;
}

async function handlePresignedUpload(body: RequestBody, userId: string) {
  const validationError = validateUploadPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const key = createUploadKey(body, userId);
  const publicUrl = getR2PublicUrl(key);
  const presignedUrl = await getPresignedUploadUrl(key, body.contentType, 600, body.size);
  await db.insert(operationLogs).values({ userId, action: "file.upload", resourceType: body.mediaType,
    metadata: { phase: "requested", filename: body.filename, size: body.size, url: publicUrl, storageKey: key, storage: "r2" } });

  return NextResponse.json({
    presignedUrl,
    publicUrl,
    key,
    mediaType: body.mediaType,
    storage: "r2",
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, resetIn } = await checkRateLimit(
      `upload:${session.user.id}`,
      RateLimitConfigs.upload.limit,
      RateLimitConfigs.upload.windowMs
    );
    if (!allowed) {
      return NextResponse.json(
        { error: `Too many uploads. Retry after ${Math.ceil(resetIn / 1000)}s` },
        { status: 429 }
      );
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: "Expected JSON upload request" }, { status: 415 });
    }
    const body = (await request.json()) as RequestBody;
    return handlePresignedUpload(body, session.user.id);
  } catch (error) {
    console.error("R2 upload route error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
