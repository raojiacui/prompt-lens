import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, userApiKeys } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";

// GET /api/settings/api-key - 获取用户的 API Key
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKeys = await db.query.userApiKeys.findMany({
      where: eq(userApiKeys.userId, session.user.id),
    });

    // 返回时隐藏 API Key
    const sanitizedKeys = apiKeys.map((key) => ({
      id: key.id,
      provider: key.provider,
      isActive: key.isActive,
      createdAt: key.createdAt,
      apiKey: key.apiKey.substring(0, 8) + "***" + key.apiKey.substring(key.apiKey.length - 4),
    }));

    return NextResponse.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error("API key get error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/settings/api-key - 保存用户的 API Key
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { provider, apiKey } = body;

    if (!provider || !apiKey) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 验证 API Key 格式
    if (provider === "zhipu" && !apiKey.includes(".")) {
      return NextResponse.json({ error: "Invalid Zhipu API Key format" }, { status: 400 });
    }
    if (provider === "gemini" && !apiKey.startsWith("AIza")) {
      return NextResponse.json({ error: "Invalid Gemini API Key format" }, { status: 400 });
    }

    // 检查是否已存在该提供商的 API Key
    const existing = await db.query.userApiKeys.findFirst({
      where: and(
        eq(userApiKeys.userId, session.user.id),
        eq(userApiKeys.provider, provider as any)
      ),
    });

    if (existing) {
      // 更新现有
      await db
        .update(userApiKeys)
        .set({
          apiKey,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(userApiKeys.id, existing.id));
    } else {
      // 创建新的
      await db.insert(userApiKeys).values({
        userId: session.user.id,
        provider: provider as any,
        apiKey,
        isActive: true,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key save error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/settings/api-key - 删除用户的 API Key
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

    // 检查是否属于当前用户
    const existing = await db.query.userApiKeys.findFirst({
      where: and(
        eq(userApiKeys.id, id),
        eq(userApiKeys.userId, session.user.id)
      ),
    });

    if (!existing) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    await db.delete(userApiKeys).where(eq(userApiKeys.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
