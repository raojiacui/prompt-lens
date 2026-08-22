import { NextResponse } from "next/server";
import { requireReferenceVideoUser } from "@/lib/reference-video/auth";
import { db, operationLogs } from "@/lib/db";
import { uploadToR2 } from "@/lib/cloudflare/r2";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

export async function POST(request: Request) {
  const auth = await requireReferenceVideoUser(request.headers);
  if (auth.response) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing replacement asset file" },
        { status: 400 },
      );
    }

    const assetType = formData.get("assetType") || "product";
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const key = `users/${auth.user.id}/assets/${randomUUID()}.${ext}`;
    const url = await uploadToR2(buffer, key, getContentType(file.name));

    await db.insert(operationLogs).values({
      userId: auth.user.id,
      action: "file.upload",
      resourceType: "project_asset",
      metadata: {
        phase: "completed",
        filename: file.name,
        size: file.size,
        url,
        storageKey: key,
        storage: "r2",
        assetType: typeof assetType === "string" ? assetType : "product",
      },
    });

    return NextResponse.json({
      id: randomUUID(),
      type: typeof assetType === "string" ? assetType : "product",
      fileName: file.name,
      mimeType: file.type || getContentType(file.name),
      size: file.size,
      url,
    });
  } catch (error) {
    console.error("Project asset upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process replacement asset",
      },
      { status: 500 },
    );
  }
}
