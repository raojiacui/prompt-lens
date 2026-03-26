"use client";

import { useState, useRef, useEffect } from "react";
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

type Tab = "analyze" | "audio" | "edit" | "history" | "stats" | "settings";

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
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
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

  useEffect(() => {
    if (session?.user) {
      const userRole = (session.user as any).role;
      setIsAdmin(userRole === "admin");

      if (userRole === "admin") {
        setStatsLoading(true);
        fetch("/api/stats")
          .then(res => res.json())
          .then(data => {
            setStats(data);
            setStatsLoading(false);
          })
          .catch(() => {
            setStatsLoading(false);
          });
      }
    }
  }, [session]);

  return (
    <div className="min-h-screen bg-anthropic">
      {/* 顶部导航 */}
      <header className="bg-[#F5F3EC]/90 backdrop-blur-md border-b border-[#D8D5CC] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-8 md:w-9 h-8 md:h-9 rounded-lg bg-[#D97757] flex items-center justify-center shadow-sm">
              <svg className="w-4 md:w-5 h-4 md:h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C9.5 2 7.5 4 7.5 6.5C7.5 7.5 7.8 8.4 8.3 9.1C7.5 10.5 7 12.2 7 14C7 18.4 10.4 22 15 22C19.6 22 23 18.4 23 14C23 12.2 22.5 10.5 21.7 9.1C22.2 8.4 22.5 7.5 22.5 6.5C22.5 4 20.5 2 18 2C15.5 2 13.5 3.5 12.5 5.5C12.3 5.3 12 2 12 2Z"/>
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
              { key: "analyze", label: "画面", shortLabel: "分析", icon: "⚡" },
              { key: "audio", label: "音频", shortLabel: "分析", icon: "🎵" },
              { key: "edit", label: "视频", shortLabel: "剪辑", icon: "✂️" },
              { key: "history", label: "历史", shortLabel: "记录", icon: "📋" },
              { key: "stats", label: "统计", icon: "📊" },
              { key: "settings", label: "设置", icon: "⚙️" }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as Tab)}
                className={cn(
                  "px-3 md:px-5 py-2 md:py-3 text-xs md:text-sm font-medium rounded-t-lg transition-all duration-200 flex items-center gap-1 md:gap-2 whitespace-nowrap min-h-[44px]",
                  activeTab === tab.key
                    ? "bg-[#F5F3EC] text-[#D97757] border-t-2 border-[#D97757]"
                    : "text-[#6B6860] hover:text-[#141413] hover:bg-[#F5F3EC]/50"
                )}
              >
                <span className="text-sm md:text-base">{tab.icon}</span>
                <span className="md:hidden">{tab.label}</span>
                <span className="hidden md:inline">{tab.shortLabel}</span>
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

        {/* 统计页面 - 仅管理员可见 */}
        {activeTab === "stats" && (
          <div className="animate-fade-in">
            {!isAdmin ? (
              <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
                <CardContent className="py-10 text-center text-[#6B6860]">
                  只有管理员可以查看统计信息
                </CardContent>
              </Card>
            ) : statsLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : stats ? (
              <div className="space-y-6">
                {/* 概览统计 */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  {[
                    { label: "总用户", value: stats.overview?.totalUsers || 0, change: stats.overview?.newUsers || 0 },
                    { label: "画面分析", value: stats.overview?.totalAnalyses || 0, change: stats.overview?.newAnalyses || 0 },
                    { label: "音频分析", value: stats.overview?.totalAudioAnalyses || 0 },
                    { label: "视频剪辑", value: stats.overview?.totalVideoClips || 0 },
                    { label: "活跃天数", value: stats.dailyTrend?.length || 0 },
                    { label: "统计周期", value: stats.period || 30, suffix: "天" }
                  ].map((item, i) => (
                    <Card key={i} className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
                      <CardContent className="pt-4">
                        <div className="text-2xl font-medium text-[#D97757]" style={{ fontFamily: 'var(--font-display)' }}>{item.value}{item.suffix}</div>
                        <div className="text-sm text-[#6B6860]">{item.label}</div>
                        {item.change !== undefined && (
                          <div className="text-xs text-[#5B8C5A]">+{item.change} 新增</div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* 最近7天趋势 */}
                <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-[#141413]" style={{ fontFamily: 'var(--font-display)' }}>最近7天分析趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2 h-32">
                      {stats.dailyTrend?.map((day: any, i: number) => (
                        <div key={i} className="flex-1 flex flex-col items-center">
                          <div
                            className="w-full bg-[#D97757] rounded-t transition-all hover:bg-[#C96848]"
                            style={{ height: `${Math.min(100, (day.count / Math.max(1, stats.dailyTrend?.reduce((a: number, b: any) => Math.max(a, b.count), 0))) * 100)}%` }}
                          />
                          <div className="text-xs text-[#6B6860] mt-1">{day.date?.slice(5) || ""}</div>
                          <div className="text-xs font-medium text-[#141413]">{day.count || 0}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* 最近注册用户 */}
                <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-[#141413]" style={{ fontFamily: 'var(--font-display)' }}>最近注册用户</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {stats.recentUsers?.map((u: any) => (
                        <div key={u.id} className="flex items-center justify-between py-2 border-b border-[#D8D5CC]/50 last:border-0">
                          <div>
                            <div className="font-medium text-[#141413]">{u.name || "未设置名字"}</div>
                            <div className="text-sm text-[#6B6860]">{u.email}</div>
                          </div>
                          <div className="text-sm text-[#6B6860]">
                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ""}
                          </div>
                        </div>
                      ))}
                      {(!stats.recentUsers || stats.recentUsers.length === 0) && (
                        <div className="text-center text-[#6B6860] py-4">暂无用户</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
                <CardContent className="py-10 text-center text-[#6B6860]">
                  加载统计数据失败
                </CardContent>
              </Card>
            )}
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
