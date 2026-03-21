"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function LoginPage() {
  const handleOAuthSignIn = async (provider: "google" | "github") => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    try {
      const response = await fetch(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: provider,
          callbackURL: "/dashboard",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          window.location.href = "/dashboard";
        }
      } else {
        console.error("Sign in failed:", await response.text());
        alert("登录失败，请重试");
      }
    } catch (error) {
      console.error("Sign in error:", error);
      alert("登录出错，请重试");
    }
  };

  return (
    <div className="min-h-screen bg-anthropic flex items-center justify-center p-4">
      {/* 背景装饰 - 径向渐变 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#D97757]/5 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-[#5B8C5A]/5 rounded-full blur-[80px]"></div>
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-xl bg-[#D97757] flex items-center justify-center shadow-md">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-xl font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>Prompt Analyzer</span>
        </Link>

        <Card className="bg-[#F5F3EC]/90 backdrop-blur-sm border border-[#D8D5CC] shadow-xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl text-[#141413]" style={{ fontFamily: 'var(--font-display)' }}>
              欢迎回来
            </CardTitle>
            <CardDescription className="text-[#6B6860]">
              登录以保存您的分析历史
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-2">
            {/* GitHub 登录 */}
            <Button
              onClick={() => handleOAuthSignIn("github")}
              variant="outline"
              className="w-full h-12 border-[#C8C4BC] text-[#6B6860] hover:text-[#141413] hover:border-[#141413] hover:bg-[#F5F3EC] rounded-xl flex items-center justify-center gap-3 transition-all"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              使用 GitHub 账号登录
            </Button>

            {/* 分隔线 */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#D8D5CC]"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-[#F5F3EC] text-[#9C9890]">或</span>
              </div>
            </div>

            {/* 跳过登录 */}
            <Link href="/dashboard">
              <Button
                variant="outline"
                className="w-full h-12 border-[#C8C4BC] text-[#6B6860] hover:text-[#141413] hover:border-[#141413] hover:bg-[#F5F3EC] rounded-xl transition-all"
              >
                跳过登录，直接使用
              </Button>
            </Link>

            <p className="text-center text-xs text-[#9C9890] mt-4" style={{ fontFamily: 'var(--font-body)' }}>
              登录后可保存分析历史，方便后续查看
            </p>
          </CardContent>
        </Card>

        {/* 返回首页 */}
        <div className="text-center mt-6">
          <Link href="/" className="text-sm text-[#6B6860] hover:text-[#D97757] transition-colors">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
