import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { getR2ObjectSize, getR2PublicUrl } from "@/lib/cloudflare/r2";
import { and, eq, sql } from "drizzle-orm";
import { validUploadSize } from "@/lib/media-upload-policy";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const filename = typeof body?.filename === "string" ? body.filename : "";
    const mediaType = body?.mediaType === "video" || body?.mediaType === "image" ? body.mediaType as "video" | "image" : null;
    const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : 0;

    if (!mediaType || !key.startsWith(`uploads/${session.user.id}/${mediaType}/`) || !url || !filename || !validUploadSize(size, mediaType)) {
      return NextResponse.json({ error: "Missing upload completion payload" }, { status: 400 });
    }
    if (url !== getR2PublicUrl(key)) {
      return NextResponse.json({ error: "Upload URL does not match R2 object" }, { status: 400 });
    }

    const [upload] = await db.select().from(operationLogs).where(and(
      eq(operationLogs.userId, session.user.id), eq(operationLogs.action, "file.upload"), eq(operationLogs.resourceType, mediaType),
      sql`${operationLogs.metadata}->>'storageKey' = ${key}`, sql`${operationLogs.metadata}->>'phase' IN ('requested', 'completed')`,
    )).limit(1);
    const metadata = upload?.metadata as Record<string, unknown> | undefined;
    if (!upload || metadata?.size !== size || metadata?.url !== url || metadata?.filename !== filename) {
      return NextResponse.json({ error: "Upload does not match its reservation" }, { status: 409 });
    }
    const objectSize = await getR2ObjectSize(key);
    if (objectSize !== size) {
      return NextResponse.json({ error: "Uploaded file could not be verified" }, { status: 409 });
    }

    await db.update(operationLogs).set({
      metadata: {
        phase: "completed",
        filename,
        size,
        url,
        storageKey: key,
        storage: "r2",
      },
    }).where(eq(operationLogs.id, upload.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record upload completion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
