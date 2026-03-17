import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#F7F6F3]">
      {/* 导航栏 */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#B8C5D6]/30">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7C9A92] to-[#8FA9A3] flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-xl font-semibold text-[#3D3D3D]">Prompt Analyzer</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-[#3D3D3D] hover:text-[#7C9A92]">登录</Button>
            </Link>
            <Link href="/dashboard">
              <Button className="bg-[#7C9A92] hover:bg-[#6B8A82] text-white rounded-lg px-5">
                开始使用
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          {/* 标题区域 */}
          <div className="mb-8">
            <h1 className="text-5xl font-bold text-[#3D3D3D] mb-4 leading-tight">
              AI 视频提示词
              <span className="text-[#7C9A92]">智能分析</span>
            </h1>
            <p className="text-xl text-[#6B6B6B] max-w-2xl mx-auto leading-relaxed">
              上传视频或图片，AI 将自动分析画面内容，生成精准的提示词，助您创作精彩 AI 视频
            </p>
          </div>

          {/* 功能卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {[
              { icon: "🎬", title: "视频分析", desc: "智能提取关键帧，分析场景、动作、氛围" },
              { icon: "🖼️", title: "图片分析", desc: "单图或多图批量分析，提取视觉特征" },
              { icon: "🤖", title: "多API支持", desc: "智谱AI、Gemini、OpenRouter 自由选择" }
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-[#B8C5D6]/20">
                <div className="text-4xl mb-3">{item.icon}</div>
                <h3 className="text-lg font-semibold text-[#3D3D3D] mb-2">{item.title}</h3>
                <p className="text-[#6B6B6B] text-sm">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA 按钮 */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-12">
            <Link href="/dashboard">
              <Button size="lg" className="bg-[#7C9A92] hover:bg-[#6B8A82] text-white text-lg px-8 py-6 rounded-xl">
                立即体验 →
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-[#B8C5D6] text-[#3D3D3D] hover:bg-[#F7F6F3] text-lg px-8 py-6 rounded-xl">
                登录保存历史
              </Button>
            </Link>
          </div>

          {/* 装饰元素 */}
          <div className="mt-20 relative">
            <div className="absolute -top-10 left-1/4 w-32 h-32 bg-[#7C9A92]/10 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-10 right-1/4 w-40 h-40 bg-[#D4A574]/10 rounded-full blur-3xl"></div>
          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="border-t border-[#B8C5D6]/30 py-8 text-center text-[#6B6B6B]">
        <p>© 2024 Prompt Analyzer. AI 视频提示词分析工具.</p>
      </footer>
    </div>
  );
}
