"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-anthropic">
      {/* 导航栏 - 移动端优化 */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#F5F3EC]/95 backdrop-blur-md border-b border-[#D8D5CC]">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 md:gap-3 group">
            <div className="w-9 md:w-10 h-9 md:h-10 rounded-xl bg-[#D97757] flex items-center justify-center shadow-md">
              <svg className="w-5 md:w-6 h-5 md:h-6 text-white" viewBox="0 0 32 32">
                {/* 外层花瓣 */}
                <path d="M16 2C10 4 6 9 5 14C4 18 5 22 7 25C9 28 13 30 16 30C19 30 23 28 25 25C27 22 28 18 27 14C26 9 22 4 16 2Z" fill="currentColor" opacity="0.9"/>
                {/* 中层花瓣 */}
                <path d="M16 6C12 8 9 12 8 16C7 20 9 24 11 26C13 28 16 29 16 29C16 29 19 28 21 26C23 24 25 20 24 16C23 12 20 8 16 6Z" fill="#E5685C"/>
                {/* 内层花瓣 */}
                <path d="M16 12C14 14 12 17 12 20C12 23 14 25 16 26C18 25 20 23 20 20C20 17 18 14 16 12Z" fill="#F0887A"/>
                {/* 花蕊 */}
                <ellipse cx="16" cy="18" rx="3" ry="2" fill="#FFCC00"/>
              </svg>
            </div>
            <span className="text-base md:text-lg font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>Prompt Lens</span>
          </Link>

          {/* 桌面端导航 */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-[#6B6860] hover:text-[#141413] hover:bg-[#D8D5CC]/50 rounded-lg px-4">
                登录
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button className="bg-[#D97757] hover:bg-[#C96848] text-white rounded-lg px-5 shadow-sm hover:shadow-md transition-all">
                开始使用
              </Button>
            </Link>
          </div>

          {/* 移动端菜单按钮 */}
          <button
            className="md:hidden p-2 text-[#6B6860]"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* 移动端下拉菜单 */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-[#F5F3EC] border-t border-[#D8D5CC] px-4 py-4 space-y-3">
            <Link href="/login" className="block" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="outline" className="w-full border-[#C8C4BC] text-[#6B6860]">
                登录
              </Button>
            </Link>
            <Link href="/dashboard" className="block" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full bg-[#D97757] hover:bg-[#C96848] text-white">
                开始使用
              </Button>
            </Link>
          </div>
        )}
      </header>

      {/* 主内容区 */}
      <main className="pt-24 md:pt-32 pb-16 md:pb-20 px-4 md:px-6">
        <div className="max-w-5xl mx-auto">
          {/* 标题区域 */}
          <div className="mb-12 md:mb-16 relative">
            {/* 装饰元素 - 移动端隐藏 */}
            <div className="hidden md:block absolute -left-16 top-0 w-32 h-32 bg-[#D97757]/5 rounded-full blur-3xl"></div>
            <div className="hidden md:block absolute -right-8 -bottom-8 w-40 h-40 bg-[#6B8C5A]/5 rounded-full blur-3xl"></div>

            <div className="relative">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-medium text-[#141413] leading-[1.2] md:leading-[1.15] mb-4 md:mb-6" style={{ fontFamily: 'var(--font-display)' }}>
                用 AI 读懂画面
                <br className="md:hidden" />
                <span className="md:inline"> </span>
                <span className="text-[#D97757]">生成提示词</span>
              </h1>
              <p className="text-base md:text-xl text-[#6B6860] max-w-xl leading-relaxed" style={{ fontFamily: 'var(--font-body)' }}>
                上传视频或图片，AI 自动分析场景、动作，光影，生成精准的提示词，助您创作精彩 AI 视频。
              </p>
            </div>
          </div>

          {/* 功能卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-12 md:mb-16">
            {[
              {
                icon: (
                  <svg className="w-6 h-6" viewBox="0 0 32 32">
                    <path d="M16 2C10 4 6 9 5 14C4 18 5 22 7 25C9 28 13 30 16 30C19 30 23 28 25 25C27 22 28 18 27 14C26 9 22 4 16 2Z" fill="currentColor" opacity="0.9"/>
                    <path d="M16 6C12 8 9 12 8 16C7 20 9 24 11 26C13 28 16 29 16 29C16 29 19 28 21 26C23 24 25 20 24 16C23 12 20 8 16 6Z" fill="#E5685C"/>
                    <path d="M16 12C14 14 12 17 12 20C12 23 14 25 16 26C18 25 20 23 20 20C20 17 18 14 16 12Z" fill="#F0887A"/>
                    <ellipse cx="16" cy="18" rx="3" ry="2" fill="#FFCC00"/>
                  </svg>
                ),
                title: "视频分析",
                desc: "智能提取关键帧，分析场景转换、人物动作，光影氛围",
                color: "orange"
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ),
                title: "图片分析",
                desc: "单图或多图批量分析，提取视觉特征与风格",
                color: "green"
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ),
                title: "多 API 支持",
                desc: "智谱 AI、Google Gemini、OpenRouter 自由切换",
                color: "blue"
              }
            ].map((item, i) => (
              <div
                key={i}
                className="stagger-item bg-[#F5F3EC] rounded-2xl p-5 md:p-6 border border-[#D8D5CC] hover:border-[#D97757]/30 transition-all duration-300 hover:shadow-lg group"
              >
                <div className={`w-11 md:w-12 h-11 md:h-12 rounded-xl flex items-center justify-center mb-3 md:mb-4 transition-transform group-hover:scale-110 ${
                  item.color === 'orange' ? 'bg-[#D97757]/10 text-[#D97757]' :
                  item.color === 'green' ? 'bg-[#5B8C5A]/10 text-[#5B8C5A]' :
                  'bg-[#6A9BCC]/10 text-[#6A9BCC]'
                }`}>
                  {item.icon}
                </div>
                <h3 className="text-base md:text-lg font-medium text-[#141413] mb-2" style={{ fontFamily: 'var(--font-heading)' }}>{item.title}</h3>
                <p className="text-sm text-[#6B6860] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA 按钮 - 移动端优化 */}
          <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-start">
            <Link href="/dashboard">
              <Button size="lg" className="w-full sm:w-auto bg-[#D97757] hover:bg-[#C96848] text-white text-base md:text-lg px-6 md:px-8 py-4 md:py-5 rounded-xl shadow-md hover:shadow-lg transition-all min-h-[52px] md:min-h-[60px]">
                立即体验 →
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-[#C8C4BC] text-[#6B6860] hover:text-[#141413] hover:border-[#141413] text-base md:text-lg px-6 md:px-8 py-4 md:py-5 rounded-xl bg-transparent min-h-[52px] md:min-h-[60px]">
                登录保存历史
              </Button>
            </Link>
          </div>

          {/* 装饰线条 */}
          <div className="mt-16 md:mt-24 relative">
            <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#D8D5CC] to-transparent"></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-[#D97757] rounded-full"></div>
          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="border-t border-[#D8D5CC] py-6 md:py-8">
        <div className="max-w-6xl mx-auto px-4 md:px-6 text-center">
          <p className="text-[#9C9890] text-sm" style={{ fontFamily: 'var(--font-body)' }}>
            © 2026 Prompt Lens · AI 视频提示词分析工具
          </p>
        </div>
      </footer>
    </div>
  );
}
