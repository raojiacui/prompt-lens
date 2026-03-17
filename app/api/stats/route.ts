import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, analysisHistory, audioAnalysis, videoClip } from "@/lib/db/schema";
import { eq, count, gte, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 检查是否是管理员
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // 获取统计数据的日期范围
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 1. 总用户数
    const totalUsersResult = await db.select({ count: count() }).from(user);
    const totalUsers = totalUsersResult[0]?.count || 0;

    // 2. 新增用户数
    const newUsersResult = await db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, startDate));
    const newUsers = newUsersResult[0]?.count || 0;

    // 3. 总分析次数
    const totalAnalysesResult = await db
      .select({ count: count() })
      .from(analysisHistory);
    const totalAnalyses = totalAnalysesResult[0]?.count || 0;

    // 4. 新增分析次数
    const newAnalysesResult = await db
      .select({ count: count() })
      .from(analysisHistory)
      .where(gte(analysisHistory.createdAt, startDate));
    const newAnalyses = newAnalysesResult[0]?.count || 0;

    // 5. 总音频分析次数
    const totalAudioResult = await db
      .select({ count: count() })
      .from(audioAnalysis);
    const totalAudioAnalyses = totalAudioResult[0]?.count || 0;

    // 6. 总视频剪辑次数
    const totalVideoResult = await db
      .select({ count: count() })
      .from(videoClip);
    const totalVideoClips = totalVideoResult[0]?.count || 0;

    // 7. 最近7天的分析记录
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentAnalyses = await db
      .select({
        createdAt: analysisHistory.createdAt,
      })
      .from(analysisHistory)
      .where(gte(analysisHistory.createdAt, sevenDaysAgo))
      .orderBy(desc(analysisHistory.createdAt));

    // 按日期分组统计
    const dailyMap = new Map<string, number>();
    recentAnalyses.forEach((item) => {
      const date = new Date(item.createdAt).toISOString().slice(0, 10);
      dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
    });

    const dailyTrend = Array.from(dailyMap.entries()).map(([date, count]) => ({
      date,
      count,
    })).sort((a, b) => a.date.localeCompare(b.date));

    // 8. 最近注册的用户
    const recentUsers = await db.query.user.findMany({
      orderBy: (users, { desc }) => [desc(users.createdAt)],
      limit: 5,
    });

    return NextResponse.json({
      overview: {
        totalUsers,
        newUsers,
        totalAnalyses,
        newAnalyses,
        totalAudioAnalyses,
        totalVideoClips,
      },
      dailyTrend,
      recentUsers: recentUsers.map((u) => ({
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
