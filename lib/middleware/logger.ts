import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, operationLogs } from "@/lib/db";

/**
 * 记录操作日志的中间件
 */
export async function logOperation(
  request: NextRequest,
  action: string,
  metadata: Record<string, any> = {}
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    await db.insert(operationLogs).values({
      userId: session?.user?.id,
      action: action as any,
      metadata,
      ipAddress: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    });
  } catch (error) {
    console.error("Failed to log operation:", error);
  }
}

/**
 * 获取客户端 IP 地址
 */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * 清理旧日志（保留 30 天）
 */
export async function cleanupOldLogs() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 这里可以实现清理逻辑
  // 注意：最好使用 cron job 或单独的清理服务
}
