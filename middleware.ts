import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // 安全头部配置
  const securityHeaders = {
    // 防止 XSS 攻击
    "X-XSS-Protection": "1; mode=block",
    // 防止点击劫持
    "X-Frame-Options": "DENY",
    // 防止 MIME 类型嗅探
    "X-Content-Type-Options": "nosniff",
    // 引用者策略
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // 权限策略
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };

  // 应用安全头部
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Content Security Policy
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", cspHeader);

  // 移除暴露服务器信息的头部
  response.headers.delete("X-Powered-By");
  response.headers.delete("Server");

  return response;
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径除了:
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (图标)
     * - public 目录下的静态文件
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)",
  ],
};
