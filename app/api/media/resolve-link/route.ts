import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";
import { LINK_IMPORT_CREDITS, LINK_IMPORT_PRICING_VERSION } from "@/lib/billing/link-import-pricing";
import { reserveCommercialTask, settleCommercialTaskInTransaction, settleCommercialTask } from "@/lib/billing/commercial-wallet";
import { ingestLinkedMediaWithWorker } from "@/lib/ffmpeg-worker/client";
import { resolveLinkedMedia } from "@/lib/media-resolver";
import { sourcePlatform } from "@/lib/media-resolver/leaperone";
import { extractVideoLink } from "@/lib/media-resolver/video-link-input";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

function statusForError(message: string) {
  if (message.includes("仅支持") || message.includes("暂不支持") || message.includes("格式无效")) return 400;
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
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!rawUrl) return NextResponse.json({ error: "请粘贴视频链接。" }, { status: 400 });
  let url: string;
  try {
    url = extractVideoLink(rawUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "视频链接格式无效" }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: "请求标识无效，请刷新后重试。" }, { status: 400 });
  }
  if (process.env.COMMERCIAL_CONSUMPTION_ENABLED !== "true") {
    return NextResponse.json({ error: "视频链接导入暂未开放。" }, { status: 503 });
  }

  try {
    sourcePlatform(url);
    const taskKey = `link-import:${requestId}`;
    const quote = {
      kind: "link_import",
      pricingVersion: LINK_IMPORT_PRICING_VERSION,
      urlHash: createHash("sha256").update(url).digest("hex"),
    };
    const { reservation, created } = await reserveCommercialTask({
      userId: session.user.id, taskKey, credits: LINK_IMPORT_CREDITS, rewrites: 0, quote,
    });
    if (!created) {
      if (reservation.state === "held") {
        return NextResponse.json({ code: "LINK_IMPORT_PENDING", error: "这次导入仍在处理中，请稍后查看，避免重复扣费。" }, { status: 409 });
      }
      const [previous] = await db.select().from(operationLogs).where(and(
        eq(operationLogs.userId, session.user.id),
        sql`${operationLogs.metadata}->>'linkImportRequestId' = ${requestId}`,
      ));
      const result = (previous?.metadata as Record<string, unknown> | undefined)?.linkImportResult;
      if (result) return NextResponse.json(result);
      return NextResponse.json({ code: "LINK_IMPORT_RETRY_NEW_REQUEST", error: "此前导入失败，未消耗积分或解析次数，请重新发起。" }, { status: 409 });
    }

    let result: Record<string, unknown>;
    try {
      const source = await resolveLinkedMedia(url);
      const stored = await ingestLinkedMediaWithWorker(source);
      const duration = stored.metadata.duration ?? source.duration;
      result = {
        mediaUrl: stored.mediaUrl,
        storageKey: stored.storageKey,
        mediaType: "video",
        platform: source.platform,
        filename: stored.filename || source.filename,
        title: source.title,
        duration,
        metadata: stored.metadata,
        chargedCredits: LINK_IMPORT_CREDITS,
      };
    } catch (error) {
      // A confirmed failure delivers no media, so return the hold. Unknown settlement failures stay held.
      await settleCommercialTask({ userId: session.user.id, taskKey, credits: 0, rewrites: 0 });
      const message = error instanceof Error ? error.message : "视频链接解析失败";
      if (message.includes("未配置")) {
        return NextResponse.json({ code: "LINK_RESOLVER_NOT_CONFIGURED", error: "视频链接解析服务尚未启用。" }, { status: 503 });
      }
      return NextResponse.json({ code: "LINK_IMPORT_FAILED", error: message }, { status: statusForError(message) });
    }

    await db.transaction(async (tx) => {
      await tx.insert(operationLogs).values({
        userId: session.user.id,
        action: "file.upload",
        resourceType: "video",
        metadata: {
          phase: "server-upload",
          filename: result.filename,
          url: result.mediaUrl,
          storageKey: result.storageKey,
          storage: "r2",
          source: "linked-media",
          sourcePlatform: result.platform,
          sourceUrl: url,
          duration: result.duration,
          linkImportRequestId: requestId,
          linkImportResult: result,
        },
      });
      await settleCommercialTaskInTransaction(tx, { userId: session.user.id, taskKey, credits: LINK_IMPORT_CREDITS, rewrites: 0, linkImportDelivered: true });
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频链接解析失败";
    if (message === "LINK_IMPORT_ALLOWANCE_EXHAUSTED") return NextResponse.json({ code: message, error: "套餐链接解析次数已用完，请充值或改用本地文件上传。" }, { status: 402 });
    if (message === "INSUFFICIENT_COMMERCIAL_BALANCE") return NextResponse.json({ code: "INSUFFICIENT_COMMERCIAL_BALANCE", error: `余额不足，导入视频链接需 ${LINK_IMPORT_CREDITS} 积分。` }, { status: 402 });
    if (message === "COMMERCIAL_WALLET_UNDER_REVIEW") return NextResponse.json({ error: "账户余额暂不可用，请联系客服。" }, { status: 403 });
    if (message === "Task quote replay mismatch") return NextResponse.json({ error: "请求标识已用于其他视频链接，请刷新后重试。" }, { status: 409 });
    if (message.includes("未配置")) {
      return NextResponse.json({ code: "LINK_RESOLVER_NOT_CONFIGURED", error: "视频链接解析服务尚未启用。" }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
