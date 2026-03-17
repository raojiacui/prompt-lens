import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory } from "@/lib/db";
import { eq, desc, like, or, and, count } from "drizzle-orm";

// GET /api/history - 获取用户历史记录
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || "";
    const favorite = searchParams.get("favorite");
    const mediaType = searchParams.get("mediaType");
    const offset = (page - 1) * limit;

    // 构建查询条件
    const conditions: any[] = [eq(analysisHistory.userId, session.user.id)];

    if (search) {
      conditions.push(
        or(
          like(analysisHistory.prompt, `%${search}%`),
          like(analysisHistory.corePrompt, `%${search}%`),
          like(analysisHistory.note, `%${search}%`)
        )!
      );
    }

    if (favorite === "true") {
      conditions.push(eq(analysisHistory.favorite, true));
    }

    if (mediaType) {
      conditions.push(eq(analysisHistory.mediaType, mediaType as any));
    }

    const whereCondition = and(...conditions) ?? undefined;

    // 获取历史记录
    const history = await db.query.analysisHistory.findMany({
      where: whereCondition,
      limit,
      offset,
      orderBy: [desc(analysisHistory.createdAt)],
    });

    // 获取总数
    const total = await db
      .select({ count: count() })
      .from(analysisHistory)
      .where(eq(analysisHistory.userId, session.user.id));

    return NextResponse.json({
      history,
      total: total[0]?.count || 0,
      page,
      limit,
    });
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
