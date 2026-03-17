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
import { cn } from "@/lib/utils";

type Tab = "analyze" | "audio" | "edit" | "history" | "settings";

export default function DashboardPage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("analyze");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(8);
  const [analyzeMode, setAnalyzeMode] = useState<"single" | "batch">("single");
  const [provider, setProvider] = useState<"zhipu" | "gemini" | "openrouter">("zhipu");
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
    setProgress("正在上传文件...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url, mediaType } = await uploadRes.json();
      setProgress("AI 正在分析中...");

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: url, mediaType, frameCount, analyzeMode, provider }),
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
    <div className="min-h-screen bg-[#F7F6F3]">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-[#B8C5D6]/30 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#7C9A92] to-[#8FA9A3] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-[#3D3D3D]">Prompt Analyzer</span>
          </div>

          {session?.user && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {session.user.image && (
                  <img src={session.user.image} alt="" className="w-8 h-8 rounded-full ring-2 ring-[#7C9A92]/30" />
                )}
                <span className="text-sm text-[#6B6B6B] hidden sm:inline">{session.user.email}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => signOut()} className="border-[#B8C5D6] text-[#6B6B6B] hover:text-[#D4A574]">
                退出
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* 标签栏 */}
      <div className="bg-white border-b border-[#B8C5D6]/30 sticky top-[65px] z-40">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1">
            {[
              { key: "analyze", label: "画面分析", icon: "⚡" },
              { key: "audio", label: "音频分析", icon: "🎵" },
              { key: "edit", label: "视频剪辑", icon: "✂️" },
              { key: "history", label: "历史记录", icon: "📋" },
              { key: "settings", label: "设置", icon: "⚙️" }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as Tab)}
                className={cn(
                  "px-5 py-3 text-sm font-medium rounded-t-lg transition-all duration-200 flex items-center gap-2",
                  activeTab === tab.key
                    ? "bg-[#F7F6F3] text-[#7C9A92] border-t-2 border-[#7C9A92]"
                    : "text-[#6B6B6B] hover:text-[#3D3D3D] hover:bg-[#F7F6F3]/50"
                )}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 分析页面 */}
        <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-8", activeTab === "analyze" ? "block" : "hidden")}>
          {/* 左侧：上传区域 */}
          <Card className="bg-white border-[#B8C5D6]/30 shadow-sm animate-fade-in">
            <CardHeader>
              <CardTitle className="text-[#3D3D3D] flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-[#7C9A92]/10 flex items-center justify-center text-[#7C9A92]">📁</span>
                上传文件
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 拖拽上传区域 */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300 min-h-[220px] flex flex-col items-center justify-center",
                  isDragging ? "border-[#7C9A92] bg-[#7C9A92]/5" : "border-[#B8C5D6] hover:border-[#7C9A92]/50",
                  preview && "border-transparent bg-[#F7F6F3]"
                )}
              >
                {preview ? (
                  <div className="relative">
                    {selectedFile?.type.startsWith("video/") ? (
                      <video src={preview} className="max-h-56 rounded-lg shadow-md" controls />
                    ) : (
                      <img src={preview} alt="Preview" className="max-h-56 rounded-lg shadow-md" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                      className="absolute -top-2 -right-2 w-7 h-7 bg-[#D4A574] text-white rounded-full flex items-center justify-center shadow-md hover:bg-[#C49564] transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#7C9A92]/10 flex items-center justify-center">
                      <svg className="w-8 h-8 text-[#7C9A92]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p className="text-[#3D3D3D] font-medium mb-1">点击或拖拽文件到此处</p>
                    <p className="text-sm text-[#6B6B6B]">支持 MP4, MOV, AVI, MKV, WebM, JPG, PNG, WebP</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept="video/*,image/*" onChange={handleFileSelect} className="hidden" />
              </div>

              {selectedFile && (
                <div className="flex items-center justify-between bg-[#F7F6F3] rounded-lg px-4 py-2">
                  <span className="text-sm text-[#6B6B6B] truncate">{selectedFile.name}</span>
                  <span className="text-xs text-[#7C9A92] bg-[#7C9A92]/10 px-2 py-1 rounded">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              )}

              {/* 设置选项 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-[#3D3D3D] block mb-2">提取帧数</label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={frameCount}
                    onChange={(e) => setFrameCount(Number(e.target.value))}
                    className="border-[#B8C5D6] focus:border-[#7C9A92]"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#3D3D3D] block mb-2">分析模式</label>
                  <select
                    value={analyzeMode}
                    onChange={(e) => setAnalyzeMode(e.target.value as any)}
                    className="w-full h-10 px-3 border border-[#B8C5D6] rounded-lg focus:border-[#7C9A92] outline-none bg-white"
                  >
                    <option value="single">逐帧分析</option>
                    <option value="batch">批量对比</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[#3D3D3D] block mb-2">API 提供商</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as any)}
                  className="w-full h-10 px-3 border border-[#B8C5D6] rounded-lg focus:border-[#7C9A92] outline-none bg-white"
                >
                  <option value="zhipu">智谱AI (glm-4v)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <Button
                onClick={handleAnalyze}
                disabled={!selectedFile || isLoading}
                className="w-full h-12 bg-[#7C9A92] hover:bg-[#6B8A82] text-white rounded-xl font-medium text-base"
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
          <Card className="bg-white border-[#B8C5D6]/30 shadow-sm animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-[#3D3D3D] flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-[#D4A574]/10 flex items-center justify-center text-[#D4A574]">✨</span>
                分析结果
              </CardTitle>
              {result && (
                <Button variant="outline" size="sm" onClick={copyToClipboard} className="border-[#B8C5D6] text-[#6B6B6B] hover:text-[#7C9A92] hover:border-[#7C9A92]">
                  复制
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {result ? (
                <div className="bg-[#F7F6F3] rounded-xl p-5 max-h-[550px] overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-sm text-[#3D3D3D] font-mono leading-relaxed">{result}</pre>
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[#B8C5D6]/20 flex items-center justify-center">
                    <svg className="w-10 h-10 text-[#B8C5D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-[#6B6B6B]">上传视频或图片，点击"开始分析"查看结果</p>
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

        {/* 历史记录页面 */}
        {activeTab === "history" && (
          <div className="animate-fade-in">
            <Card className="bg-white border-[#B8C5D6]/30 shadow-sm">
              <CardHeader>
                <CardTitle className="text-[#3D3D3D] flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-[#B8C5D6]/30 flex items-center justify-center">📋</span>
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
    </div>
  );
}
