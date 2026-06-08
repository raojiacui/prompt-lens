"use client";

import { useState, useRef } from "react";
import { useSession, signOut } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { HistoryList } from "@/components/history-list";
import { ApiKeySettings } from "@/components/api-key-settings";
import { AudioAnalyzeTab } from "@/components/audio-analyze-tab";
import { VideoEditTab } from "@/components/video-edit-tab";
import { VideoGenerateTab } from "@/components/video-generate-tab";
import { FloatingChat } from "@/components/floating-chat";
import { extractVideoFrames, getImageBase64 } from "@/lib/utils/frame-extractor";
import { cn } from "@/lib/utils";

type Tab = "analyze" | "audio" | "edit" | "video-gen" | "history" | "settings";

export default function DashboardPage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("analyze");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(8);
  const [analyzeMode, setAnalyzeMode] = useState<"single" | "batch">("single");
  const [provider, setProvider] = useState<"zhipu" | "gemini" | "openrouter">("openrouter");
  const [progress, setProgress] = useState("");
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith("video/") || file.type.startsWith("image/"))) {
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
      setResult(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setIsLoading(true);
    setProgress("正在提取帧...");

    try {
      let frames: string[];
      let mediaType: string;

      if (selectedFile.type.startsWith("video/")) {
        // 视频：在客户端提取帧
        frames = await extractVideoFrames(selectedFile, frameCount, (current, total) => {
          setProgress(`正在提取帧: ${current}/${total}`);
        });
        mediaType = "video";
      } else {
        // 图片：直接转 base64
        const base64 = await getImageBase64(selectedFile);
        frames = [base64];
        mediaType = "image";
      }

      setProgress("正在上传文件...");

      // 上传文件到 B2（用于存储）
      const formData = new FormData();
      formData.append("file", selectedFile);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Upload failed (${uploadRes.status}): ${errText}`);
      }
      const uploadData = await uploadRes.json();

      setProgress("AI 正在分析中...");

      // 发送帧给后端分析（而不是发送视频 URL）
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: uploadData.url,
          mediaType,
          frames, // 直接发送客户端提取的帧
          analyzeMode,
          provider,
        }),
      });

      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const data = await analyzeRes.json();
      setResult(data.prompt);
      setHistoryRefreshTrigger((prev) => prev + 1);
    } catch (error: any) {
      setResult(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress("");
    }
  };

  const copyToClipboard = () => result && navigator.clipboard.writeText(result);

  const resetUpload = () => {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-anthropic">
      {/* 顶部导航 */}
      <header className="bg-[#F5F3EC]/90 backdrop-blur-md border-b border-[#D8D5CC] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-8 md:w-9 h-8 md:h-9 rounded-lg bg-[#D97757] flex items-center justify-center shadow-sm">
              <svg className="w-4 md:w-5 h-4 md:h-5 text-white" viewBox="0 0 32 32">
                <path d="M16 2C10 4 6 9 5 14C4 18 5 22 7 25C9 28 13 30 16 30C19 30 23 28 25 25C27 22 28 18 27 14C26 9 22 4 16 2Z" fill="currentColor" opacity="0.9"/>
                <path d="M16 6C12 8 9 12 8 16C7 20 9 24 11 26C13 28 16 29 16 29C16 29 19 28 21 26C23 24 25 20 24 16C23 12 20 8 16 6Z" fill="#E5685C"/>
                <path d="M16 12C14 14 12 17 12 20C12 23 14 25 16 26C18 25 20 23 20 20C20 17 18 14 16 12Z" fill="#F0887A"/>
                <ellipse cx="16" cy="18" rx="3" ry="2" fill="#FFCC00"/>
              </svg>
            </div>
            <span className="text-base md:text-lg font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>Prompt Lens</span>
          </div>

          {session?.user && (
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center gap-2">
                {session.user.image && (
                  <img src={session.user.image} alt="" className="w-7 md:w-8 h-7 md:h-8 rounded-full ring-2 ring-[#D97757]/20" />
                )}
                <span className="text-sm text-[#6B6860] hidden sm:inline">{session.user.email}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => signOut()} className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757] rounded-lg text-xs md:text-sm">
                退出
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* 标签栏 - 移动端可横向滚动 */}
      <div className="bg-[#F5F3EC]/50 border-b border-[#D8D5CC] sticky top-[52px] md:top-[65px] z-40">
        <div className="max-w-7xl mx-0 md:mx-auto px-2 md:px-6">
          <nav className="flex gap-1 overflow-x-auto pb-px md:pb-0 -mx-2 px-2 md:mx-0 md:px-0">
            {[
              { key: "analyze", label: "视频分析" },
              { key: "audio", label: "音频分析" },
              { key: "edit", label: "视频剪辑" },
              { key: "video-gen", label: "视频生成" },
              { key: "history", label: "历史记录" },
              { key: "settings", label: "设置" }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as Tab)}
                className={cn(
                  "px-3 md:px-5 py-2 md:py-3 text-xs md:text-sm font-medium rounded-t-lg transition-all duration-200 whitespace-nowrap min-h-[44px]",
                  activeTab === tab.key
                    ? "bg-[#F5F3EC] text-[#D97757] border-t-2 border-[#D97757]"
                    : "text-[#6B6860] hover:text-[#141413] hover:bg-[#F5F3EC]/50"
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-6 md:py-8">
        {/* 分析页面 */}
        <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8", activeTab === "analyze" ? "block" : "hidden")}>
          {/* 左侧：上传区域 */}
          <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm animate-fade-in">
            <CardHeader className="pb-2 md:pb-0">
              <CardTitle className="text-base md:text-lg text-[#141413] flex items-center gap-2 md:gap-3" style={{ fontFamily: 'var(--font-display)' }}>
                <span className="w-8 md:w-10 h-8 md:h-10 rounded-lg md:rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                  <svg className="w-4 md:w-5 h-4 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </span>
                上传文件
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 md:space-y-5">
              {/* 拖拽上传区域 */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "relative border-2 border-dashed rounded-xl p-6 md:p-10 text-center cursor-pointer transition-all duration-300 min-h-[180px] md:min-h-[220px] flex flex-col items-center justify-center",
                  isDragging ? "border-[#D97757] bg-[#D97757]/5" : "border-[#C8C4BC] hover:border-[#D97757]/50",
                  preview && "border-transparent bg-[#ECE9E0]"
                )}
              >
                {preview ? (
                  <div className="relative">
                    {selectedFile?.type.startsWith("video/") ? (
                      <video src={preview} className="max-h-40 md:max-h-56 rounded-lg shadow-md" controls />
                    ) : (
                      <img src={preview} alt="Preview" className="max-h-40 md:max-h-56 rounded-lg shadow-md" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                      className="absolute -top-2 -right-2 w-7 h-7 bg-[#D97757] text-white rounded-full flex items-center justify-center shadow-md hover:bg-[#C96848] transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-12 md:w-16 h-12 md:h-16 mx-auto mb-3 md:mb-4 rounded-xl md:rounded-2xl bg-[#D97757]/10 flex items-center justify-center">
                      <svg className="w-6 md:w-8 h-6 md:h-8 text-[#D97757]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p className="text-[#141413] font-medium mb-1 text-sm md:text-base">点击或拖拽文件到此处</p>
                    <p className="text-xs md:text-sm text-[#6B6860]">支持 MP4, MOV, AVI, MKV, WebM, JPG, PNG, WebP</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept="video/*,image/*" onChange={handleFileSelect} className="hidden" />
              </div>

              {selectedFile && (
                <div className="flex items-center justify-between bg-[#ECE9E0] rounded-lg px-4 py-2">
                  <span className="text-sm text-[#6B6860] truncate">{selectedFile.name}</span>
                  <span className="text-xs text-[#D97757] bg-[#D97757]/10 px-2 py-1 rounded">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              )}

              {/* 设置选项 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-[#141413] block mb-2">提取帧数</label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={frameCount}
                    onChange={(e) => setFrameCount(Number(e.target.value))}
                    className="border-[#C8C4BC] focus:border-[#D97757] bg-white"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#141413] block mb-2">分析模式</label>
                  <select
                    value={analyzeMode}
                    onChange={(e) => setAnalyzeMode(e.target.value as any)}
                    className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                  >
                    <option value="single">逐帧分析</option>
                    <option value="batch">批量对比</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">API 提供商</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as any)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="zhipu">智谱AI (glm-4v)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <Button
                onClick={handleAnalyze}
                disabled={!selectedFile || isLoading}
                className="w-full h-12 md:h-12 bg-[#D97757] hover:bg-[#C96848] text-white rounded-xl font-medium text-base shadow-sm hover:shadow-md transition-all min-h-[48px]"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Spinner size="sm" className="border-white" />
                    {progress || "处理中..."}
                  </span>
                ) : (
                  "开始分析"
                )}
              </Button>
            </CardContent>
          </Card>

          {/* 右侧：结果区域 */}
          <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between pb-2 md:pb-0">
              <CardTitle className="text-base md:text-lg text-[#141413] flex items-center gap-2 md:gap-3" style={{ fontFamily: 'var(--font-display)' }}>
                <span className="w-8 md:w-10 h-8 md:h-10 rounded-lg md:rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                  <svg className="w-4 md:w-5 h-4 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                </span>
                分析结果
              </CardTitle>
              {result && (
                <Button variant="outline" size="sm" onClick={copyToClipboard} className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757] rounded-lg text-xs md:text-sm">
                  复制
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {result ? (
                <div className="bg-[#ECE9E0] rounded-xl p-4 md:p-5 max-h-[300px] md:max-h-[550px] overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-xs md:text-sm text-[#141413] font-mono leading-relaxed">{result}</pre>
                </div>
              ) : (
                <div className="text-center py-10 md:py-16">
                  <div className="w-16 md:w-20 h-16 md:h-20 mx-auto mb-3 md:4 rounded-full bg-[#D8D5CC]/30 flex items-center justify-center">
                    <svg className="w-8 md:w-10 h-8 md:h-10 text-[#9C9890]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-[#6B6860] text-sm md:text-base">上传视频或图片，点击"开始分析"查看结果</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 音频分析页面 */}
        <AudioAnalyzeTab activeTab={activeTab} />

        {/* 视频剪辑页面 */}
        {activeTab === "edit" && (
          <div className="animate-fade-in">
            <VideoEditTab />
          </div>
        )}

        {/* 视频生成页面 */}
        {activeTab === "video-gen" && (
          <div className="animate-fade-in">
            <VideoGenerateTab />
          </div>
        )}

        {/* 历史记录页面 */}
        {activeTab === "history" && (
          <div className="animate-fade-in">
            <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
              <CardHeader>
                <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
                  <span className="w-10 h-10 rounded-xl bg-[#D8D5CC]/30 flex items-center justify-center text-[#6B6860]">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </span>
                  历史记录
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HistoryList refreshTrigger={historyRefreshTrigger} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* 设置页面 */}
        {activeTab === "settings" && (
          <div className="animate-fade-in">
            <ApiKeySettings />
          </div>
        )}
      </main>

      {/* 悬浮聊天助手 */}
      <FloatingChat />
    </div>
  );
}
