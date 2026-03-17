import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, user, analysisHistory, operationLogs } from "@/lib/db";
import { eq, desc, count, sql } from "drizzle-orm";

// 检查用户是否为管理员
async function checkAdmin(session: any): Promise<boolean> {
  if (!session?.user) return false;

  const currentUser = await db.query.user.findFirst({
    where: eq(user.id, session.user.id),
  });

  return currentUser?.role === "admin";
}

// GET /api/admin/users - 获取所有用户列表
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user || !(await checkAdmin(session))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    // 获取用户列表
    const users = await db.query.user.findMany({
      limit,
      offset,
      orderBy: [desc(user.createdAt)],
    });

    // 获取用户统计
    const userStats = await Promise.all(
      users.map(async (u) => {
        const analysisCount = await db
          .select({ count: count() })
          .from(analysisHistory)
          .where(eq(analysisHistory.userId, u.id));

        return {
          ...u,
          analysisCount: analysisCount[0]?.count || 0,
        };
      })
    );

    // 获取总数
    const total = await db.select({ count: count() }).from(user);

    return NextResponse.json({
      users: userStats,
      total: total[0]?.count || 0,
      page,
      limit,
    });
  } catch (error) {
    console.error("Admin users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/admin/users - 更新用户（禁言/解封）
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user || !(await checkAdmin(session))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { userId, action, banReason } = body;

    if (!userId || !action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (action === "ban") {
      await db
        .update(user)
        .set({
          banned: true,
          banReason: banReason || "Banned by admin",
          banExpires: null, // 永久封禁
        })
        .where(eq(user.id, userId));

      // 记录操作日志
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "admin.user_ban",
        resourceType: "user",
        resourceId: userId,
        metadata: { banReason },
      });
    } else if (action === "unban") {
      await db
        .update(user)
        .set({
          banned: false,
          banReason: null,
          banExpires: null,
        })
        .where(eq(user.id, userId));

      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "admin.user_unban",
        resourceType: "user",
        resourceId: userId,
      });
    } else if (action === "set_admin") {
      await db
        .update(user)
        .set({ role: "admin" })
        .where(eq(user.id, userId));
    } else if (action === "remove_admin") {
      await db
        .update(user)
        .set({ role: "user" })
        .where(eq(user.id, userId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin user update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/users - 删除用户
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user || !(await checkAdmin(session))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // 不能删除自己
    if (userId === session.user.id) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    // 删除用户（级联删除相关数据）
    await db.delete(user).where(eq(user.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin user delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
