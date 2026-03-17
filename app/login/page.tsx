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
    <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#7C9A92]/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[#D4A574]/10 rounded-full blur-3xl"></div>
      </div>

      <Card className="w-full max-w-md relative bg-white/90 backdrop-blur-sm border-[#B8C5D6]/30 shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#7C9A92] to-[#8FA9A3] flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <CardTitle className="text-2xl text-[#3D3D3D]">Prompt Analyzer</CardTitle>
          <CardDescription className="text-[#6B6B6B]">登录以保存您的分析历史</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          {/* GitHub 登录 */}
          <Button
            onClick={() => handleOAuthSignIn("github")}
            variant="outline"
            className="w-full h-12 border-[#B8C5D6] text-[#3D3D3D] hover:bg-[#F7F6F3] rounded-xl flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            使用 GitHub 账号登录
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#B8C5D6]/50"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-[#6B6B6B]">或</span>
            </div>
          </div>

          <Link href="/dashboard">
            <Button
              variant="outline"
              className="w-full h-12 border-[#B8C5D6] text-[#6B6B6B] hover:bg-[#F7F6F3] rounded-xl"
            >
              跳过登录，直接使用
            </Button>
          </Link>

          <p className="text-center text-xs text-[#6B6B6B] mt-4">
            登录后可保存分析历史，方便后续查看
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
