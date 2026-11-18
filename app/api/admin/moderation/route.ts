import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { db, moderationRecords } from "@/lib/db";
import {
  latestModerationRecords, listModerationTerms, moderationControlsEnabled,
  MODERATION_CATEGORIES, updateModerationTerm, deleteModerationTerm,
} from "@/lib/safety/moderation-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: NextRequest) {
  const admin = await getAdminUserFromHeaders(request.headers);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  if (!moderationControlsEnabled()) return NextResponse.json({ error: "Test project only" }, { status: 404, headers });
  try {
    const [terms, records] = await Promise.all([listModerationTerms(), latestModerationRecords()]);
    return NextResponse.json({ terms, records }, { headers });
  } catch {
    return NextResponse.json({ error: "Moderation database unavailable; apply test migration first." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminUserFromHeaders(request.headers);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  if (!moderationControlsEnabled()) return NextResponse.json({ error: "Test project only" }, { status: 404, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400, headers });
  try {
    if (body.action === "delete_term") {
      if (!isUuid(body.id)) return NextResponse.json({ error: "Invalid term id" }, { status: 400, headers });
      try {
        await deleteModerationTerm(body.id, admin.id);
      } catch (error) {
        if (error instanceof Error && error.message === "NOT_FOUND")
          return NextResponse.json({ error: "规则不存在或已删除，请刷新列表。" }, { status: 404, headers });
        throw error;
      }
      return NextResponse.json({ success: true }, { headers });
    }
    if (body.action === "save_term") {
      if (body.id != null && !isUuid(body.id)) return NextResponse.json({ error: "Invalid term id" }, { status: 400, headers });
      if (typeof body.phrase !== "string" || body.phrase.length > 160 ||
          !MODERATION_CATEGORIES.includes(body.category as typeof MODERATION_CATEGORIES[number]) ||
          !["block", "review"].includes(String(body.decision)) ||
          typeof body.enabled !== "boolean" ||
          (body.note != null && (typeof body.note !== "string" || body.note.length > 500))) {
        return NextResponse.json({ error: "Invalid term fields" }, { status: 400, headers });
      }
      const term = await updateModerationTerm({
        id: body.id as string | undefined, phrase: body.phrase,
        category: body.category as typeof MODERATION_CATEGORIES[number],
        action: body.decision as "block" | "review", enabled: body.enabled,
        note: (body.note as string | undefined), actorId: admin.id,
      });
      return NextResponse.json({ term }, { headers });
    }
    if (body.action === "review_record") {
      if (!isUuid(body.recordId) || !["confirmed_violation", "false_positive", "escalated"].includes(String(body.verdict)) ||
          typeof body.note !== "string" || body.note.trim().length < 8 || body.note.length > 1500) {
        return NextResponse.json({ error: "A record, verdict and 8+ character review note are required" }, { status: 400, headers });
      }
      const [original] = await db.select().from(moderationRecords).where(eq(moderationRecords.id, body.recordId));
      if (!original || original.stage === "policy_change" || original.stage === "manual") return NextResponse.json({ error: "Reviewable record not found" }, { status: 404, headers });
      await db.insert(moderationRecords).values({
        stage: "manual", provider: "admin_review",
        verdict: body.verdict as string, category: original.category,
        relatedRecordId: original.id, userId: original.userId,
        taskId: original.taskId, reviewerId: admin.id, reviewNote: body.note.trim(),
        reasonCode: "human_review",
      });
      // Human notes do not directly unlock a blocked video. Manual release
      // requires an independently reviewed, authorized delivery workflow.
      return NextResponse.json({ success: true }, { headers });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400, headers });
  } catch (error) {
    if (error instanceof Error && /INVALID_|NOT_FOUND/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    return NextResponse.json({ error: "Policy update failed; the database or unique term constraint may be unavailable." }, { status: 503, headers });
  }
}
