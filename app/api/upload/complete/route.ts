import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { getR2ObjectSize, getR2PublicUrl } from "@/lib/cloudflare/r2";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    const mediaType = body?.mediaType === "video" || body?.mediaType === "image" ? body.mediaType : "file";
    const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : 0;

    if (!key.startsWith(`uploads/${session.user.id}/`) || !url || !filename || size <= 0) {
      return NextResponse.json({ error: "Missing upload completion payload" }, { status: 400 });
    }
    if (url !== getR2PublicUrl(key)) {
      return NextResponse.json({ error: "Upload URL does not match R2 object" }, { status: 400 });
    }

    const objectSize = await getR2ObjectSize(key);
    if (objectSize !== size) {
      return NextResponse.json({ error: "Uploaded file could not be verified" }, { status: 409 });
    }

    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "file.upload",
      resourceType: mediaType,
      metadata: {
        phase: "completed",
        filename,
        size,
        url,
        storageKey: key,
        storage: "r2",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record upload completion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
