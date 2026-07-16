import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./i18n/config";

export function middleware(request: NextRequest) {
  // 1. 解析 locale：cookie 优先，未命中检测 Accept-Language
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const acceptLang = request.headers.get("accept-language") ?? "";
  const prefersEn = acceptLang
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .some((tag) => tag.startsWith("en"));

  const detectedLocale = isLocale(cookieLocale)
    ? cookieLocale
    : prefersEn
    ? "en"
    : defaultLocale;

  const response = NextResponse.next();

  // 2. 若 cookie 不存在，写入检测到的 locale（不重写 URL —— cookie 模式核心）
  if (!isLocale(cookieLocale)) {
    response.cookies.set(LOCALE_COOKIE, detectedLocale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  // 3. 安全头部配置（原有逻辑保留）
  const securityHeaders = {
    "X-XSS-Protection": "1; mode=block",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };

  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // 4. Content Security Policy
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.amcharts.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", cspHeader);

  // 5. 移除暴露服务器信息的头部
  response.headers.delete("X-Powered-By");
  response.headers.delete("Server");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)",
  ],
};
