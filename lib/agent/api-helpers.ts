/**
 * Agent API 统一响应 / 鉴权辅助。
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { NextRequest } from "next/server";
import type { AgentApiResponse } from "./types";
import { AgentError, toHttpError } from "./errors";

const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  const body: AgentApiResponse<T> = { success: true, data };
  return NextResponse.json(body, init);
}

export function fail(error: string, status = 400, code?: string): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status });
}

export function fromError(error: unknown): NextResponse {
  const { status, body } = toHttpError(error);
  return NextResponse.json(body, { status });
}

/**
 * 从请求中解析当前会话。开发环境直接使用固定测试用户，便于本地测试 agent。
 */
export async function requireUser(request: NextRequest): Promise<{ userId: string }> {
  if (process.env.NODE_ENV === "development") {
    return { userId: DEV_USER_ID };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    throw new AgentError("UNAUTHORIZED", "Unauthorized", 401);
  }
  return { userId: session.user.id };
}