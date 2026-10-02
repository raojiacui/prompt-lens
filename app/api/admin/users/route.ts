import { NextRequest, NextResponse } from "next/server";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { db, user, operationLogs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { queryUserDirectory } from "@/lib/admin/user-directory";
import type { AdminUserView } from "@/lib/admin/user-directory-types";

// GET /api/admin/users - 获取所有用户列表
export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAdminUserFromHeaders(request.headers);

    if (!adminUser) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const bounded = (key: string, fallback: number, max: number) => {
      const value = Number(searchParams.get(key) || fallback);
      return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value))) : fallback;
    };
    const page = bounded("page", 1, 100000);
    const limit = bounded("limit", 20, 100);
    const view = searchParams.get("view") || "all";
    const query = (searchParams.get("q") || "").trim();
    if (!["all", "paid", "credits", "usage"].includes(view) || query.length > 128) {
      return NextResponse.json({ error: "Invalid search parameters" }, { status: 400 });
    }
    const result = await queryUserDirectory({ view: view as AdminUserView, query, page, limit });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/admin/users - 更新用户（禁言/解封）
export async function PATCH(request: NextRequest) {
  try {
    const adminUser = await getAdminUserFromHeaders(request.headers);

    if (!adminUser) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { userId, action, banReason } = body;

    if (!userId || !action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (action === "set_admin" || action === "remove_admin" || (action === "ban" && userId === adminUser.id)) {
      return NextResponse.json({ error: "The product has one fixed administrator" }, { status: 400 });
    }
    if (!["ban", "unban"].includes(action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

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
        userId: adminUser.id,
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
        userId: adminUser.id,
        action: "admin.user_unban",
        resourceType: "user",
        resourceId: userId,
      });
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
    const adminUser = await getAdminUserFromHeaders(request.headers);

    if (!adminUser) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // 不能删除自己
    if (userId === adminUser.id) {
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


