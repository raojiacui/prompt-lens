import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs, user } from "@/lib/db";
import { eq, desc, sql, and, count } from "drizzle-orm";

// 检查用户是否为管理员
async function checkAdmin(session: any): Promise<boolean> {
  if (!session?.user) return false;

  const currentUser = await db.query.user.findFirst({
    where: eq(user.id, session.user.id),
  });

  return currentUser?.role === "admin";
}

// GET /api/admin/logs - 获取操作日志
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user || !(await checkAdmin(session))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const action = searchParams.get("action");
    const userId = searchParams.get("userId");
    const offset = (page - 1) * limit;

    // 构建查询条件
    const conditions = [];

    if (action) {
      conditions.push(eq(operationLogs.action, action as any));
    }

    if (userId) {
      conditions.push(eq(operationLogs.userId, userId));
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // 获取日志列表
    const logs = await db.query.operationLogs.findMany({
      where: whereCondition,
      limit,
      offset,
      orderBy: [desc(operationLogs.createdAt)],
    });

    // 获取总数
    const total = await db.select({ count: count() }).from(operationLogs);

    // 获取各类操作的统计
    const stats = await db
      .select({
        action: operationLogs.action,
        count: count(),
      })
      .from(operationLogs)
      .groupBy(operationLogs.action);

    return NextResponse.json({
      logs,
      total: total[0]?.count || 0,
      page,
      limit,
      stats,
    });
  } catch (error) {
    console.error("Admin logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/logs - 清理旧日志
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user || !(await checkAdmin(session))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    // 计算日期
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // 删除旧日志
    const result = await db
      .delete(operationLogs)
      .where(sql`${operationLogs.createdAt} < ${cutoffDate.toISOString()}`);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Admin logs delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
