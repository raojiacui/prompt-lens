import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, analysisHistory, audioAnalysis, videoClip } from "@/lib/db/schema";
import { eq, count, sql, and, gte } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 检查是否是管理员
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // 获取统计数据的日期范围（可选参数）
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 1. 总用户数
    const totalUsers = await db.select({ count: count() }).from(user);

    // 2. 新增用户数（指定时间段内）
    const newUsers = await db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, startDate));

    // 3. 总分析次数
    const totalAnalyses = await db
      .select({ count: count() })
      .from(analysisHistory);

    // 4. 新增分析次数
    const newAnalyses = await db
      .select({ count: count() })
      .from(analysisHistory)
      .where(gte(analysisHistory.createdAt, startDate));

    // 5. 总音频分析次数
    const totalAudioAnalyses = await db
      .select({ count: count() })
      .from(audioAnalysis);

    // 6. 总视频剪辑次数
    const totalVideoClips = await db
      .select({ count: count() })
      .from(videoClip);

    // 7. 最近7天的每日分析趋势
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyAnalyses = await db
      .select({
        date: sql<string>`DATE(${analysisHistory.createdAt})`,
        count: count(),
      })
      .from(analysisHistory)
      .where(gte(analysisHistory.createdAt, sevenDaysAgo))
      .groupBy(sql`DATE(${analysisHistory.createdAt})`)
      .orderBy(sql`DATE(${analysisHistory.createdAt})`);

    // 8. 按 Provider 统计
    const providerStats = await db
      .select({
        provider: analysisHistory.mediaType,
        count: count(),
      })
      .from(analysisHistory)
      .groupBy(analysisHistory.mediaType);

    // 9. 最近注册的用户
    const recentUsers = await db.query.user.findMany({
      orderBy: (user, { desc }) => [desc(user.createdAt)],
      limit: 5,
    });

    return NextResponse.json({
      overview: {
        totalUsers: totalUsers[0]?.count || 0,
        newUsers: newUsers[0]?.count || 0,
        totalAnalyses: totalAnalyses[0]?.count || 0,
        newAnalyses: newAnalyses[0]?.count || 0,
        totalAudioAnalyses: totalAudioAnalyses[0]?.count || 0,
        totalVideoClips: totalVideoClips[0]?.count || 0,
      },
      dailyTrend: dailyAnalyses,
      typeBreakdown: providerStats,
      recentUsers: recentUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
      })),
      period: days,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
