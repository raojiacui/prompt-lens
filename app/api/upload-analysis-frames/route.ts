import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteFromR2, getPresignedUploadUrl, getR2PublicUrl } from "@/lib/cloudflare/r2";
import {
  analysisFrameOwnerPrefix,
  MAX_ANALYSIS_FRAME_BYTES,
  MAX_ANALYSIS_FRAMES,
} from "@/lib/ai/analysis-frame-input";
import { checkRateLimit, RateLimitConfigs } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

type FrameMetadata = {
  filename: string;
  contentType: string;
  size: number;
};

function validateFrames(value: unknown): FrameMetadata[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANALYSIS_FRAMES) return null;
  if (!value.every((frame) => (
    frame &&
    typeof frame.filename === "string" &&
    frame.contentType === "image/jpeg" &&
    typeof frame.size === "number" &&
    Number.isFinite(frame.size) &&
    frame.size > 0 &&
    frame.size <= MAX_ANALYSIS_FRAME_BYTES
  ))) return null;
  return value as FrameMetadata[];
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { allowed, resetIn } = checkRateLimit(
      `${session.user.id}:analysis-frames`,
      RateLimitConfigs.upload.limit,
      RateLimitConfigs.upload.windowMs
    );
    if (!allowed) {
      return NextResponse.json(
        { error: `Too many uploads. Retry after ${Math.ceil(resetIn / 1000)}s` },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const frames = validateFrames(body?.frames);
    if (!frames) return NextResponse.json({ error: "Invalid analysis frames" }, { status: 400 });

    const runId = crypto.randomUUID();
    const prefix = `${analysisFrameOwnerPrefix(session.user.id)}${runId}/`;
    const uploads = await Promise.all(frames.map(async (frame, index) => {
      const key = `${prefix}frame-${String(index + 1).padStart(2, "0")}.jpg`;
      return {
        key,
        publicUrl: getR2PublicUrl(key),
        presignedUrl: await getPresignedUploadUrl(key, frame.contentType, 600),
      };
    }));

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error("Analysis frame upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to prepare frame uploads" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const keys = body?.keys;
    const ownerPrefix = analysisFrameOwnerPrefix(session.user.id);
    if (
      !Array.isArray(keys) ||
      keys.length === 0 ||
      keys.length > MAX_ANALYSIS_FRAMES ||
      !keys.every((key) => typeof key === "string" && key.startsWith(ownerPrefix) && /\.jpe?g$/i.test(key))
    ) {
      return NextResponse.json({ error: "Invalid analysis frame keys" }, { status: 400 });
    }

    await Promise.allSettled(keys.map((key) => deleteFromR2(key)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Analysis frame cleanup error:", error);
    return NextResponse.json({ error: "Failed to clean up analysis frames" }, { status: 500 });
  }
}
