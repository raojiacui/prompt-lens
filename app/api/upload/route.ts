import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";

const ALLOWED_VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"];
const ALLOWED_IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"];
const MAX_VIDEO_SIZE_MB = 200;
const MAX_IMAGE_SIZE_MB = 20;

type UploadClientPayload = {
  filename: string;
  size: number;
  contentType: string;
  mediaType: "video" | "image";
};

type UploadTokenPayload = UploadClientPayload & {
  userId: string;
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

function parseClientPayload(clientPayload: string | null): UploadClientPayload {
  if (!clientPayload) {
    throw new Error("Missing upload metadata");
  }

  const parsed = JSON.parse(clientPayload) as Partial<UploadClientPayload>;
  if (
    !parsed.filename ||
    typeof parsed.size !== "number" ||
    !parsed.contentType ||
    (parsed.mediaType !== "video" && parsed.mediaType !== "image")
  ) {
    throw new Error("Invalid upload metadata");
  }

  return parsed as UploadClientPayload;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      request,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
          throw new Error("Unauthorized");
        }

        const { allowed, resetIn } = checkRateLimit(
          session.user.id,
          RateLimitConfigs.upload.limit,
          RateLimitConfigs.upload.windowMs
        );

        if (!allowed) {
          throw new Error(`Too many uploads. Retry after ${Math.ceil(resetIn / 1000)}s`);
        }

        const metadata = parseClientPayload(clientPayload);
        if (!pathname.startsWith(`uploads/${metadata.mediaType}/`)) {
          throw new Error("Invalid upload path");
        }
        if (!isAllowedFile(metadata.filename, metadata.mediaType)) {
          throw new Error("Invalid file type");
        }
        if (metadata.size > maxSizeBytes(metadata.mediaType)) {
          const maxMb = metadata.mediaType === "video" ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;
          throw new Error(`File too large. Max size: ${maxMb}MB`);
        }

        return {
          allowedContentTypes: [metadata.contentType],
          maximumSizeInBytes: maxSizeBytes(metadata.mediaType),
          tokenPayload: JSON.stringify({
            ...metadata,
            userId: session.user.id,
          } satisfies UploadTokenPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return;
        const metadata = JSON.parse(tokenPayload) as UploadTokenPayload;

        await db.insert(operationLogs).values({
          userId: metadata.userId,
          action: "file.upload",
          resourceType: metadata.mediaType,
          metadata: {
            filename: metadata.filename,
            size: metadata.size,
            url: blob.url,
          },
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
