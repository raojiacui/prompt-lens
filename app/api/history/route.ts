import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory } from "@/lib/db";
import { eq } from "drizzle-orm";
import { listAnalysisHistory } from "@/lib/workflow/analysis-history";

// GET /api/history - 获取用户历史记录
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(await listAnalysisHistory(session.user.id, new URL(request.url).searchParams),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json({ error: "Unable to load analysis history" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

// POST /api/history - 创建历史记录（通常由分析 API 自动创建）
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { prompt, corePrompt, mediaType, mediaUrl, mediaName, frameCount, analyzeMode, note } = body;

    if (!prompt || !mediaType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await db.insert(analysisHistory).values({
      userId: session.user.id,
      prompt,
      corePrompt,
      mediaType,
      mediaUrl,
      mediaName,
      frameCount,
      analyzeMode,
      note,
    }).returning();

    return NextResponse.json({
      success: true,
      record: result[0],
    });
  } catch (error) {
    console.error("History create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/history - 更新历史记录
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, note, tags, favorite } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // 检查记录是否属于当前用户
    const existing = await db.query.analysisHistory.findFirst({
      where: eq(analysisHistory.id, id),
    });

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    // 更新记录
    await db
      .update(analysisHistory)
      .set({
        note,
        tags,
        favorite,
        updatedAt: new Date(),
      })
      .where(eq(analysisHistory.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("History update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/history - 删除历史记录
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // 检查记录是否属于当前用户
    const existing = await db.query.analysisHistory.findFirst({
      where: eq(analysisHistory.id, id),
    });

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    await db.delete(analysisHistory).where(eq(analysisHistory.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("History delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
