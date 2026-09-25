import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { ingestLinkedMediaWithWorker } from "@/lib/ffmpeg-worker/client";
import { resolveLinkedMediaWithLeaperOne } from "@/lib/media-resolver/leaperone";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

function statusForError(message: string) {
  if (message.includes("仅支持") || message.includes("格式无效")) return 400;
  if (message.includes("未配置")) return 503;
  return 502;
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const { allowed, resetIn } = await checkRateLimit(`linked-media:${session.user.id}`, 3, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: `链接解析过于频繁，请在 ${Math.ceil(resetIn / 1000)} 秒后重试。` }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "请粘贴视频链接。" }, { status: 400 });

  try {
    const source = await resolveLinkedMediaWithLeaperOne(url);
    const stored = await ingestLinkedMediaWithWorker(source);
    const duration = stored.metadata.duration ?? source.duration;

    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "file.upload",
      resourceType: "video",
      metadata: {
        phase: "server-upload",
        filename: stored.filename || source.filename,
        url: stored.mediaUrl,
        storageKey: stored.storageKey,
        storage: "r2",
        source: "linked-media",
        sourcePlatform: source.platform,
        sourceUrl: url,
        duration,
      },
    });

    return NextResponse.json({
      mediaUrl: stored.mediaUrl,
      storageKey: stored.storageKey,
      mediaType: "video",
      platform: source.platform,
      filename: stored.filename || source.filename,
      title: source.title,
      duration,
      metadata: stored.metadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频链接解析失败";
    if (message.includes("未配置")) {
      return NextResponse.json({ code: "LINK_RESOLVER_NOT_CONFIGURED", error: "视频链接解析服务尚未启用。" }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
