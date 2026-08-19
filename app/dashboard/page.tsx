"use client";

import { useState, useRef, type ElementType } from "react";
import { useSession, signOut } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { HistoryList } from "@/components/history-list";
import { ApiKeySettings } from "@/components/api-key-settings";
import { AudioAnalyzeTab } from "@/components/audio-analyze-tab";
import { VideoEditTab } from "@/components/video-edit-tab";
import { ReferenceVideoComposer } from "@/components/reference-video/ReferenceVideoComposer";
import { FloatingChat } from "@/components/floating-chat";
import { CreateWithAgent } from "@/components/agent/create-with-agent";
import { VideoWorkflowCreate } from "@/components/workflow/video-workflow-create";
import { extractVideoFrames, getImageBase64 } from "@/lib/utils/frame-extractor";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { ChevronLeft, ChevronRight, Clock, FolderKanban, Home, LogOut, Mic2, PlusCircle, Scissors, Settings, Sparkles, Video, X } from "lucide-react";

type Tab = "home" | "create" | "projects" | "analyze" | "audio" | "edit" | "video-gen" | "history" | "settings";
type FeatureTab = "analyze" | "audio" | "edit" | "video-gen";

export default function DashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const validTabs: Tab[] = ["home", "create", "projects", "analyze", "audio", "edit", "video-gen", "history", "settings"];

  const rawTab = searchParams.get("tab") as Tab | null;
  const activeTab = rawTab && validTabs.includes(rawTab) ? rawTab : "home";

  const selectTab = (tab: Tab, extraParams?: Record<string, string>) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (tab === "home") {
      nextParams.delete("tab");
      nextParams.delete("videoGenPrompt");
      nextParams.delete("projectId");
      nextParams.delete("sceneId");
      nextParams.delete("versionId");
      nextParams.delete("duration");
    } else {
      nextParams.set("tab", tab);
      if (tab !== "video-gen") {
        nextParams.delete("videoGenPrompt");
      nextParams.delete("projectId");
      nextParams.delete("sceneId");
      nextParams.delete("versionId");
      nextParams.delete("duration");
      }
    }
    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value) nextParams.set(key, value);
        else nextParams.delete(key);
      });
    }
    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const videoGenPrompt = activeTab === "video-gen" ? searchParams.get("videoGenPrompt") : null;
  const videoGenProjectId = activeTab === "video-gen" ? searchParams.get("projectId") : null;
  const videoGenSceneId = activeTab === "video-gen" ? searchParams.get("sceneId") : null;
  const videoGenVersionId = activeTab === "video-gen" ? searchParams.get("versionId") : null;
  const videoGenDuration = activeTab === "video-gen" ? Number(searchParams.get("duration") || 0) : null;

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState("");
  const [frameCount, setFrameCount] = useState(8);
  const [analyzeMode, setAnalyzeMode] = useState<"single" | "batch">("single");
  const [analysisDepth, setAnalysisDepth] = useState("balanced");
  const [analysisOutputFormat, setAnalysisOutputFormat] = useState("prompt");
  const [provider, setProvider] = useState<"zhipu" | "gemini" | "openrouter">("openrouter");
  const [progress, setProgress] = useState("");
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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

  const handleAnalysisPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnalysisPrompt(e.target.value);
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 260)}px`;
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setIsLoading(true);
    setProgress(t("analyze.extractingFrames"));

    try {
      let frames: string[];
      let mediaType: string;

      if (selectedFile.type.startsWith("video/")) {
        frames = await extractVideoFrames(selectedFile, frameCount, (current, total) => {
          setProgress(t("analyze.extractingFrameProgress", { current, total }));
        });
        mediaType = "video";
      } else {
        const base64 = await getImageBase64(selectedFile);
        frames = [base64];
        mediaType = "image";
      }

      setProgress(t("analyze.uploadingFile"));

      const uploadData = await uploadMediaToBlob(selectedFile, (percentage) => {
        setProgress(t("analyze.uploadingProgress", { percent: Math.round(percentage) }));
      });

      setProgress(t("analyze.aiAnalyzing"));

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: uploadData.url,
          mediaType,
          frames,
          analyzeMode,
          provider,
          outputLanguage: locale,
          prompt: analysisPrompt,
          analysisDepth,
          outputFormat: analysisOutputFormat,
        }),
      });

      if (!analyzeRes.ok) throw new Error(t("analyze.analysisFailed"));
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

  const handleNavigateVideoGen = (prompt: string) => {
    selectTab("video-gen", { videoGenPrompt: prompt });
  };

  const handleWorkflowSendToGenerate = (payload: { prompt: string; projectId: string; sceneId: string; versionId: string; duration?: number }) => {
    selectTab("video-gen", {
      videoGenPrompt: payload.prompt,
      projectId: payload.projectId,
      sceneId: payload.sceneId,
      versionId: payload.versionId,
      duration: payload.duration ? String(Math.round(payload.duration)) : "",
    });
  };

  const featureCards: Array<{
    key: FeatureTab;
    title: string;
    description: string;
    icon: ElementType;
    image: string;
    badge?: string;
  }> = [
    {
      key: "analyze",
      title: "视频分析",
      description: "上传视频或图片，提取镜头信息并生成可复用提示词",
      icon: Sparkles,
      image: "/feature-video-analysis.png",
      badge: "LAST USED",
    },
    {
      key: "video-gen",
      title: "视频生成",
      description: "输入创意提示词，配置比例、时长和参考图生成视频",
      icon: Video,
      image: "/feature-video-generation.png",
    },
    {
      key: "audio",
      title: "音频分析",
      description: "识别视频语音，整理片段摘要并辅助选择剪辑段落",
      icon: Mic2,
      image: "/feature-audio-recognition.png",
    },
    {
      key: "edit",
      title: "视频剪辑",
      description: "用自然语言描述剪辑目标，调用 FFmpeg 服务输出成片",
      icon: Scissors,
      image: "/feature-video-edit.png",
    },
  ];

  const activeFeature = featureCards.find((feature) => feature.key === activeTab);

  const createTools = [
    { key: "create" as Tab, label: "Create", icon: PlusCircle },
    { key: "projects" as Tab, label: "Projects", icon: FolderKanban },
    { key: "analyze" as Tab, label: t("dashboard.tabs.analyze"), icon: Sparkles },
    { key: "video-gen" as Tab, label: t("dashboard.tabs.videoGen"), icon: Video },
    { key: "audio" as Tab, label: t("dashboard.tabs.audio"), icon: Mic2 },
    { key: "edit" as Tab, label: t("dashboard.tabs.edit"), icon: Scissors },
  ];

  const systemTools = [
    { key: "history" as Tab, label: t("dashboard.tabs.history"), icon: Clock },
    { key: "settings" as Tab, label: t("dashboard.tabs.settings"), icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-[var(--color-bg-base)]">
      {/* 左侧边栏：仅在非首页的功能页显示，且可折叠 */}
      {activeTab !== "home" && (
        <aside
          className={cn(
            "hidden lg:flex flex-col border-r border-[var(--color-border-default)] bg-[var(--color-bg-raised)] transition-all duration-300",
            isSidebarCollapsed ? "w-[72px] items-center" : "w-[240px]"
          )}
        >
          <div className={cn("flex items-center", isSidebarCollapsed ? "justify-center p-4" : "justify-between p-5")}>
            {!isSidebarCollapsed && (
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/prompt-lens-icon.png"
                  alt="Prompt Lens"
                  width={541}
                  height={563}
                  className="h-9 w-auto object-contain"
                />
                <span className="text-lg font-bold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
                  {t("dashboard.appName")}
                </span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]",
                isSidebarCollapsed && "mt-1"
              )}
              aria-label={isSidebarCollapsed ? t("dashboard.sidebar.expand") : t("dashboard.sidebar.collapse")}
            >
              {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className={cn("flex-1 overflow-y-auto py-2 space-y-6", isSidebarCollapsed ? "px-2 w-full" : "px-3")}>
            {!isSidebarCollapsed && (
              <div>
                <SidebarItem
                  item={{ key: "home", label: t("nav.home"), icon: Home }}
                  activeTab={activeTab}
                  onClick={() => selectTab("home")}
                  collapsed={isSidebarCollapsed}
                />
              </div>
            )}

            <div>
              {!isSidebarCollapsed && (
                <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {t("dashboard.sidebar.create")}
                </p>
              )}
              <div className="space-y-1">
                {createTools.map((item) => (
                  <SidebarItem
                    key={item.key}
                    item={item}
                    activeTab={activeTab}
                    onClick={() => selectTab(item.key)}
                    collapsed={isSidebarCollapsed}
                  />
                ))}
              </div>
            </div>

            <div>
              {!isSidebarCollapsed && (
                <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {t("dashboard.sidebar.system")}
                </p>
              )}
              <div className="space-y-1">
                {systemTools.map((item) => (
                  <SidebarItem
                    key={item.key}
                    item={item}
                    activeTab={activeTab}
                    onClick={() => selectTab(item.key)}
                    collapsed={isSidebarCollapsed}
                  />
                ))}
              </div>
            </div>
          </nav>

          <div className={cn("border-t border-[var(--color-border-default)]", isSidebarCollapsed ? "p-2 flex justify-center" : "p-3")}>
            {session?.user ? (
              <button
                type="button"
                onClick={() => signOut()}
                className={cn(
                  "flex items-center gap-3 rounded-xl text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]",
                  isSidebarCollapsed ? "h-9 w-9 justify-center p-0" : "w-full px-3 py-2.5"
                )}
                aria-label={t("auth.logout")}
              >
                <LogOut className="h-4 w-4" />
                {!isSidebarCollapsed && t("auth.logout")}
              </button>
            ) : null}
          </div>
        </aside>
      )}

      {/* 移动端顶部导航 */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-raised)] px-3 lg:hidden">
        <Link href="/" className="mr-auto flex items-center gap-2">
          <Image
            src="/prompt-lens-icon.png"
            alt="Prompt Lens"
            width={541}
            height={563}
            className="h-8 w-auto object-contain"
          />
          <span className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            {t("dashboard.appName")}
          </span>
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {[{ key: "home" as Tab, label: t("nav.home"), icon: Home }, ...createTools, ...systemTools].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectTab(item.key)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  activeTab === item.key
                    ? "bg-[#D97757]/10 text-[#D97757]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)]"
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {"label" in item ? item.label : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="min-h-full px-4 py-6 md:px-8 md:py-8">
          {activeTab === "home" && (
            <div className="min-h-[calc(100vh-7rem)] flex flex-col justify-center">
              <div className="hidden lg:flex items-center justify-between mb-8">
                <Link href="/" className="flex items-center gap-2">
                  <Image
                    src="/prompt-lens-icon.png"
                    alt="Prompt Lens"
                    width={541}
                    height={563}
                    className="h-9 w-auto object-contain"
                  />
                  <span className="text-lg font-bold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
                    {t("dashboard.appName")}
                  </span>
                </Link>
                {session?.user ? (
                  <button
                    type="button"
                    onClick={() => signOut()}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-raised)] hover:text-[var(--color-text-primary)]"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("auth.logout")}
                  </button>
                ) : null}
              </div>

              <div className="text-center mb-10 md:mb-14">
                <h1 className="text-4xl md:text-6xl font-bold tracking-normal text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                  Create with AI
                </h1>
                <p className="mt-5 text-xl md:text-2xl text-[var(--color-text-secondary)]">How would you like to get started?</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 md:gap-7">
                {featureCards.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <button
                      key={feature.key}
                      type="button"
                      onClick={() => selectTab(feature.key)}
                      className="group flex h-full flex-col text-left rounded-xl bg-[var(--color-bg-raised)] p-5 shadow-md ring-1 ring-[var(--color-border-default)] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-[var(--color-accent-orange)]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-orange)] text-left"
                    >
                      <div className="relative mb-6 aspect-[5/3] overflow-hidden rounded-xl bg-[#F3E8DA] ring-1 ring-[var(--color-border-default)]">
                        <img
                          src={feature.image}
                          alt=""
                          className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-text-primary)]/10 via-transparent to-[var(--color-bg-raised)]/5" />
                      </div>
                      <h2 className="text-2xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-heading)' }}>{feature.title}</h2>
                      <p className="mt-4 min-h-[56px] text-base leading-relaxed text-[var(--color-text-secondary)]">{feature.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="pt-8 md:pt-12">
                <CreateWithAgent onNavigateVideoGen={handleNavigateVideoGen} />
              </div>
            </div>
          )}

          {(activeTab === "create" || activeTab === "projects") && (
            <VideoWorkflowCreate onSendToGenerate={handleWorkflowSendToGenerate} />
          )}

          {activeTab === "edit" && activeFeature && (() => {
            const FeatureIcon = activeFeature.icon;
            return (
              <div className="mb-8 flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-bg-raised)] text-[#D97757] ring-1 ring-[var(--color-border-default)]">
                  <FeatureIcon className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                    {activeFeature.title}
                  </h1>
                  <p className="text-sm text-[var(--color-text-secondary)]">{activeFeature.description}</p>
                </div>
              </div>
            );
          })()}

          {/* 分析页面 */}
          {activeTab === "analyze" && (
            <div className="min-h-[calc(100vh-5rem)] bg-background text-foreground">
              <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {t("dashboard.tabs.analyze") || "Video Analysis"}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("analyze.subtitle") || "Upload a video or image and generate reusable prompts."}
                    </p>
                  </div>
                </div>

                <div className="grid items-stretch gap-4 xl:grid-cols-[0.74fr_1.26fr]">
                  <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm">
                    <div className="flex h-full flex-col space-y-4">
                      <div>
                        <h2 className="text-xl font-semibold">
                          {t("analyze.panelTitle") || "Analyze"}
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t("analyze.panelDescription") || "Upload a video or image and describe what you want to extract."}
                        </p>
                      </div>

                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={cn(
                          "rounded-2xl border border-dashed border-border bg-muted/30 p-3 transition-colors",
                          isDragging && "border-primary/70 bg-primary/5"
                        )}
                      >
                        <input ref={fileInputRef} type="file" accept="video/*,image/*" onChange={handleFileSelect} className="sr-only" />

                        {preview && selectedFile && (
                          <div className="mb-3 flex flex-wrap gap-3">
                            <div className="group relative h-24 w-32 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                              {selectedFile.type.startsWith("video/") ? (
                                <video src={preview} className="h-full w-full object-cover" muted />
                              ) : (
                                <img src={preview} alt="Preview" className="h-full w-full object-cover" />
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
                                aria-label="Remove uploaded media"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="flex min-w-0 flex-col justify-center">
                              <p className="max-w-[320px] truncate text-sm font-medium text-foreground">{selectedFile.name}</p>
                              <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-background py-3 text-center transition-colors hover:bg-accent"
                        >
                          <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l9.193-9.193a3 3 0 114.243 4.243L8.56 18.31a1.5 1.5 0 01-2.122-2.122l8.486-8.486" />
                          </svg>
                          <span className="text-base font-semibold">{t("analyze.uploadTitle") || "Upload video or image"}</span>
                          <span className="text-sm text-muted-foreground">{t("analyze.uploadHint") || "Click or drag to upload"}</span>
                        </button>
                      </div>

                      <div className="rounded-2xl border border-border bg-background p-3">
                        <Textarea
                          value={analysisPrompt}
                          onChange={handleAnalysisPromptChange}
                          placeholder="Upload a video or image to start. Add notes here only if you want..."
                          className="min-h-[108px] resize-none overflow-hidden border-0 bg-transparent p-0 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-2 text-sm font-medium">
                          {t("analyze.depth") || "Depth"}
                          <select value={analysisDepth} onChange={(e) => setAnalysisDepth(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring">
                            <option value="quick">Quick</option>
                            <option value="balanced">Balanced</option>
                            <option value="detailed">Detailed</option>
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm font-medium">
                          {t("analyze.frames") || "Frames"}
                          <select value={frameCount} onChange={(e) => setFrameCount(Number(e.target.value))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring">
                            <option value={4}>4</option>
                            <option value={8}>8</option>
                            <option value={12}>12</option>
                            <option value={16}>16</option>
                            <option value={24}>24</option>
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm font-medium">
                          {t("analyze.output") || "Output"}
                          <select value={analysisOutputFormat} onChange={(e) => setAnalysisOutputFormat(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring">
                            <option value="prompt">Prompt</option>
                            <option value="shot-list">Shot list</option>
                            <option value="summary">Summary</option>
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm font-medium">
                          {t("analyze.model") || "Model"}
                          <select value={provider} onChange={(e) => setProvider(e.target.value as any)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring">
                            <option value="openrouter">OpenRouter</option>
                            <option value="gemini">Gemini</option>
                            <option value="zhipu">Zhipu</option>
                          </select>
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {[
                          "Optional: analyze the visual style as a reusable prompt",
                          "Optional: extract shots, camera movement, and lighting",
                          "Optional: summarize story flow and emotional tone",
                          "Optional: find the best frames for editing references",
                        ].map((example) => (
                          <button
                            key={example}
                            type="button"
                            onClick={() => setAnalysisPrompt(example)}
                            className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/80 hover:text-foreground"
                          >
                            <Sparkles className="h-4 w-4" />
                            {example}
                          </button>
                        ))}
                      </div>

                      {progress && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Spinner size="sm" />
                          <span>{progress}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleAnalyze()}
                        disabled={!selectedFile || isLoading}
                        className="mt-auto flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoading ? <Spinner size="sm" /> : (
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.876L6 12zm0 0h7.5" />
                          </svg>
                        )}
                        {isLoading ? t("analyze.analyzing") || "Analyzing..." : t("analyze.start") || "Analyze"}
                      </button>
                    </div>
                  </section>

                  <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm">
                    {!result ? (
                      <div className="flex h-full flex-col items-center justify-center text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="font-medium text-foreground">Analysis result will appear here</p>
                        <p className="text-sm text-muted-foreground">Upload a file on the left and click analyze to start.</p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-background p-4">
                        <div className="flex flex-row items-center justify-between gap-4">
                          <h3 className="text-lg font-semibold text-foreground">Analysis result</h3>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => result && handleNavigateVideoGen(result)}
                              className="rounded-full border-border text-muted-foreground hover:border-primary hover:text-primary"
                            >
                              {t("analyze.createSameStyle")}
                            </Button>
                            <Button variant="outline" size="sm" onClick={copyToClipboard} className="rounded-full border-border text-muted-foreground hover:border-primary hover:text-primary">
                              Copy
                            </Button>
                          </div>
                        </div>
                        <pre className="mt-3 max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-4 text-sm leading-relaxed text-foreground">
                          {result}
                        </pre>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          )}

          {/* 音频分析页面 */}
          {activeTab === "audio" && <AudioAnalyzeTab activeTab={activeTab} />}

          {/* 视频剪辑页面 */}
          {activeTab === "edit" && (
            <div className="animate-fade-in">
              <VideoEditTab />
            </div>
          )}

          {/* 视频生成页面 */}
          {activeTab === "video-gen" && (
            <div className="animate-fade-in">
              <ReferenceVideoComposer
                initialPrompt={videoGenPrompt}
                initialProjectId={videoGenProjectId}
                initialSceneId={videoGenSceneId}
                initialProjectVersionId={videoGenVersionId}
                initialDuration={videoGenDuration}
              />
            </div>
          )}

          {/* 历史记录页面 */}
          {activeTab === "history" && (
            <div className="animate-fade-in space-y-6">
              <HistoryList refreshTrigger={historyRefreshTrigger} />
            </div>
          )}

          {/* 设置页面 */}
          {activeTab === "settings" && (
            <div className="animate-fade-in space-y-6">
              <ApiKeySettings />
            </div>
          )}
        </div>
      </main>

      {/* 悬浮聊天助手 */}
      <FloatingChat />
    </div>
  );
}

function SidebarItem({
  item,
  activeTab,
  onClick,
  collapsed = false,
}: {
  item: { key: Tab; label: string; icon: ElementType };
  activeTab: Tab;
  onClick: () => void;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  const isActive = activeTab === item.key;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center rounded-xl text-sm font-semibold transition-colors",
        collapsed
          ? "h-9 w-9 justify-center p-0"
          : "w-full gap-3 px-3 py-2.5",
        isActive
          ? "bg-[#D97757]/10 text-[#D97757]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]"
      )}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4" />
      {!collapsed && item.label}
    </button>
  );
}

