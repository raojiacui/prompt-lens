import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/auth-client";

export const metadata: Metadata = {
  title: "Prompt Analyzer - AI 视频提示词分析工具",
  description: "上传视频或图片，AI 自动分析画面内容，生成精准的提示词",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <head>
        {/* Google Fonts - Anthropic 官方字体 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Serif+Display&family=DM+Serif+Text&family=JetBrains+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* 中文支持 - 霞鹜文楷 */}
        <link
          href="https://fonts.googleapis.com/css2?family=LXGW+WenKai:wght@300;400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-anthropic">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
