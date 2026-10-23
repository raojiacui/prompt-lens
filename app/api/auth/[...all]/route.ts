import { auth } from "@/lib/auth";
import { isAccessEmailAllowed, isAccessRestricted } from "@/lib/auth/access-policy";
import { verifyEmailTransport } from "@/lib/email/smtp";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = 'nodejs';

const handler = toNextJsHandler(auth);

async function restrictedAccessResponse(request: Request, pathname: string) {
  if (!isAccessRestricted()) return null;

  if (pathname === "/api/auth/sign-in/social") {
    return Response.json(
      { error: "测试环境仅支持已授权邮箱验证码登录" },
      { status: 403 },
    );
  }

  if (request.method !== "POST") return null;

  const body = await request.clone().json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : null;
  if (email && !isAccessEmailAllowed(email)) {
    return Response.json(
      { error: "该邮箱没有当前测试环境的访问权限" },
      { status: 403 },
    );
  }

  return null;
}

function withoutAdminPlugin(next: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    // Administration uses the owner-only product endpoints, never role-based plugin endpoints.
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url).pathname).replace(/\/+/g, "/"); }
    catch { return Response.json({ error: "Invalid path" }, { status: 400 }); }
    if (pathname === "/api/auth/sign-in/anonymous" || pathname === "/api/auth/delete-anonymous-user" || pathname === "/api/auth/delete-user") {
      return Response.json({ error: "Verified account required" }, { status: 403 });
    }
    if (pathname === "/api/auth/admin" || pathname.startsWith("/api/auth/admin/")) {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }
    const accessDenied = await restrictedAccessResponse(request, pathname);
    if (accessDenied) return accessDenied;
    if (request.method === "POST" && pathname === "/api/auth/email-otp/send-verification-otp") {
      try {
        await verifyEmailTransport();
      } catch (error) {
        console.error("[Email] SMTP preflight failed", error);
        return Response.json(
          { error: "邮件服务暂时不可用，请稍后重试" },
          { status: 503 },
        );
      }
    }
    return next(request);
  };
}
export const GET = withoutAdminPlugin(handler.GET);
export const POST = withoutAdminPlugin(handler.POST);
export const PATCH = withoutAdminPlugin(handler.PATCH);
export const PUT = withoutAdminPlugin(handler.PUT);
export const DELETE = withoutAdminPlugin(handler.DELETE);
