"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Globe, DecorativeBackground } from "@/components/globe";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

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

  // 发送验证码
  const handleSendCode = async () => {
    if (!email) {
      setError("请输入邮箱地址");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("请输入有效的邮箱地址");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const response = await fetch(`${baseUrl}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email,
          type: "sign-in",
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setStep("code");
        setCountdown(60); // 60秒后可以重新发送
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(data.message || data.error || "发送验证码失败");
      }
    } catch (err) {
      setError("发送验证码失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  // 使用验证码登录
  const handleVerifyCode = async () => {
    if (!code) {
      setError("请输入验证码");
      return;
    }
    if (code.length !== 6) {
      setError("验证码为6位数字");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const response = await fetch(`${baseUrl}/api/auth/sign-in/email-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email,
          otp: code,
          callbackURL: "/dashboard",
        }),
      });

      if (response.ok) {
        window.location.href = "/dashboard";
      } else {
        const data = await response.json();
        setError(data.message || data.error || "登录失败，请检查验证码");
      }
    } catch (err) {
      setError("登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-anthropic flex items-center justify-center p-4 relative">
      {/* 3D 地球仪背景 */}
      <Globe />

      {/* 装饰性背景 */}
      <DecorativeBackground />

      {/* 遮罩层，让内容更清晰 */}
      <div className="fixed inset-0 bg-[#F5F3EC]/60 pointer-events-none z-0"></div>

      <div className="relative w-full max-w-md z-10">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-xl bg-[#D97757] flex items-center justify-center shadow-md">
            <svg className="w-7 h-7 text-white" viewBox="0 0 32 32">
              <path d="M16 2C10 4 6 9 5 14C4 18 5 22 7 25C9 28 13 30 16 30C19 30 23 28 25 25C27 22 28 18 27 14C26 9 22 4 16 2Z" fill="currentColor" opacity="0.9"/>
              <path d="M16 6C12 8 9 12 8 16C7 20 9 24 11 26C13 28 16 29 16 29C16 29 19 28 21 26C23 24 25 20 24 16C23 12 20 8 16 6Z" fill="#E5685C"/>
              <path d="M16 12C14 14 12 17 12 20C12 23 14 25 16 26C18 25 20 23 20 20C20 17 18 14 16 12Z" fill="#F0887A"/>
              <ellipse cx="16" cy="18" rx="3" ry="2" fill="#FFCC00"/>
            </svg>
          </div>
          <span className="text-xl font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>Prompt Lens</span>
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
            {/* Google 登录 */}
            <Button
              onClick={() => handleOAuthSignIn("google")}
              variant="outline"
              className="w-full h-12 border-[#C8C4BC] text-[#6B6860] hover:text-[#141413] hover:border-[#141413] hover:bg-[#F5F3EC] rounded-xl flex items-center justify-center gap-3 transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              使用 Google 账号登录
            </Button>

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

            {/* 邮箱登录表单 */}
            {step === "email" ? (
              <div className="space-y-4">
                <div>
                  <Input
                    type="email"
                    placeholder="请输入邮箱地址"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError("");
                    }}
                    className="h-12 border-[#C8C4BC] text-[#6B6860] placeholder:text-[#9C9890] rounded-xl"
                  />
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <Button
                  onClick={handleSendCode}
                  disabled={loading}
                  className="w-full h-12 bg-[#D97757] hover:bg-[#c46849] text-white rounded-xl flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner className="w-5 h-5" /> : "获取验证码"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#6B6860] text-center">
                  已发送验证码至 <span className="font-medium text-[#141413]">{email}</span>
                </p>
                <div>
                  <Input
                    type="text"
                    placeholder="请输入6位验证码"
                    value={code}
                    maxLength={6}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, "")); // 只允许数字
                      setError("");
                    }}
                    className="h-12 border-[#C8C4BC] text-[#6B6860] placeholder:text-[#9C9890] rounded-xl text-center text-lg tracking-widest"
                  />
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <Button
                  onClick={handleVerifyCode}
                  disabled={loading || code.length !== 6}
                  className="w-full h-12 bg-[#D97757] hover:bg-[#c46849] text-white rounded-xl flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner className="w-5 h-5" /> : "登录"}
                </Button>
                <div className="text-center">
                  <button
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setError("");
                    }}
                    className="text-sm text-[#6B6860] hover:text-[#D97757] underline"
                  >
                    更换邮箱地址
                  </button>
                  {countdown > 0 ? (
                    <span className="text-sm text-[#9C9890] ml-3">
                      {countdown}秒后可重新发送
                    </span>
                  ) : (
                    <button
                      onClick={handleSendCode}
                      className="text-sm text-[#D97757] hover:underline ml-3"
                    >
                      重新发送验证码
                    </button>
                  )}
                </div>
              </div>
            )}

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
