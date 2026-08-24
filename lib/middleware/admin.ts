import { NextRequest, NextResponse } from "next/server";
import { auth, getAdminUserFromHeaders } from "@/lib/auth";

/**
 * 检查用户是否为管理员
 */
export async function checkAdmin(request: NextRequest): Promise<boolean> {
  return Boolean(await getAdminUserFromHeaders(request.headers));
}
/**
 * 管理员权限保护中间件
 */
export async function requireAdmin(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const isAdminUser = await checkAdmin(request);

  if (!isAdminUser) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  return handler(request);
}

/**
 * 用户权限保护中间件
 */
export async function requireAuth(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  return handler(request);
}

