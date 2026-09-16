"use client";

import { useEffect, useState, type ElementType } from "react";
import { useSession, signOut } from "@/lib/auth/auth-client";
import { HistoryList } from "@/components/history-list";
import { ApiKeySettings } from "@/components/api-key-settings";
import { AudioAnalyzeTab } from "@/components/audio-analyze-tab";
import { VideoEditTab } from "@/components/video-edit-tab";
import { ReferenceVideoComposer } from "@/components/reference-video/ReferenceVideoComposer";
import { CreateWithAgent } from "@/components/agent/create-with-agent";
import { VideoWorkflowCreate } from "@/components/workflow/video-workflow-create";
import { AdminOverviewPanel } from "@/components/admin-overview-panel";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Home, LogOut, Mic2, Scissors, Settings, Shield, Sparkles, Video } from "lucide-react";

type Tab = "home" | "analyze" | "audio" | "edit" | "video-gen" | "history" | "settings" | "admin";
type FeatureTab = "analyze" | "audio" | "edit" | "video-gen";

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const t = useTranslations();
  const zh = useLocale() === "zh";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const currentDashboardPath = searchString ? `${pathname}?${searchString}` : pathname;
  const validTabs: Tab[] = ["home", "analyze", "audio", "edit", "video-gen", "history", "settings", "admin"];
  const authLoadingSteps = ["加载中", "加载中", "加载中"];
  const [authLoadingStep, setAuthLoadingStep] = useState(0);

  useEffect(() => {
    if (!isPending) {
      setAuthLoadingStep(0);
      return;
    }

    const timer = window.setInterval(() => {
      setAuthLoadingStep((step) => (step + 1) % authLoadingSteps.length);
    }, 900);

    return () => window.clearInterval(timer);
  }, [isPending, authLoadingSteps.length]);

  const rawTab = searchParams.get("tab");
  const activeTab: Tab = rawTab === "create" || rawTab === "projects"
    ? "analyze"
    : rawTab && validTabs.includes(rawTab as Tab)
      ? (rawTab as Tab)
      : "home";

  const selectTab = (tab: Tab, extraParams?: Record<string, string>) => {
    if (tab !== "video-gen" || !extraParams?.sceneId) {
      setHiddenSceneReferenceImageUrl(null);
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    if (tab === "home") {
      nextParams.delete("tab");
      nextParams.delete("videoGenPrompt");
      nextParams.delete("projectId");
      nextParams.delete("sceneId");
      nextParams.delete("versionId");
      nextParams.delete("duration");
      nextParams.delete("model");
    } else {
      nextParams.set("tab", tab);
      if (tab !== "video-gen" && tab !== "audio" && tab !== "edit") {
        nextParams.delete("videoGenPrompt");
        nextParams.delete("projectId");
        nextParams.delete("sceneId");
        nextParams.delete("versionId");
        nextParams.delete("duration");
        nextParams.delete("model");
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

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
    router.refresh();
  };
  const videoGenPrompt = activeTab === "video-gen" ? searchParams.get("videoGenPrompt") : null;
  const videoGenProjectId = activeTab === "video-gen" ? searchParams.get("projectId") : null;
  const videoGenSceneId = activeTab === "video-gen" ? searchParams.get("sceneId") : null;
  const videoGenVersionId = activeTab === "video-gen" ? searchParams.get("versionId") : null;
  const videoGenDuration = activeTab === "video-gen" ? Number(searchParams.get("duration") || 0) : null;
  const videoGenModel = activeTab === "video-gen" ? searchParams.get("model") : null;
  const workflowProjectId = activeTab === "audio" || activeTab === "edit" ? searchParams.get("projectId") : null;
  const workflowVersionId = activeTab === "audio" || activeTab === "edit" ? searchParams.get("versionId") : null;
  const workflowSceneId = activeTab === "audio" || activeTab === "edit" ? searchParams.get("sceneId") : null;
  const [historyRefreshTrigger] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [hiddenSceneReferenceImageUrl, setHiddenSceneReferenceImageUrl] = useState<string | null>(null);
  const sessionIsAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const [canAccessAdmin, setCanAccessAdmin] = useState(sessionIsAdmin);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace(`/login?next=${encodeURIComponent(currentDashboardPath)}`);
    }
  }, [currentDashboardPath, isPending, router, session?.user]);
  useEffect(() => {
    let cancelled = false;

    if (isPending || !session?.user) {
      setCanAccessAdmin(false);
      return;
    }

    if (sessionIsAdmin) {
      setCanAccessAdmin(true);
      return;
    }

    fetch("/api/admin/me", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!cancelled) setCanAccessAdmin(response.ok && payload?.isAdmin === true);
      })
      .catch(() => {
        if (!cancelled) setCanAccessAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, session?.user, sessionIsAdmin]);


  const handleNavigateVideoGen = (prompt: string) => {
    selectTab("video-gen", { videoGenPrompt: prompt });
  };

  const handleWorkflowSendToGenerate = (payload: { prompt: string; projectId: string; sceneId: string; versionId: string; duration?: number; modelId?: string; hiddenReferenceImageUrl?: string }) => {
    setHiddenSceneReferenceImageUrl(payload.hiddenReferenceImageUrl || null);
    selectTab("video-gen", {
      videoGenPrompt: payload.prompt,
      projectId: payload.projectId,
      sceneId: payload.sceneId,
      versionId: payload.versionId,
      duration: payload.duration ? String(Math.round(payload.duration)) : "",
      model: payload.modelId || "",
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
    { key: "analyze" as Tab, label: t("dashboard.tabs.analyze"), icon: Sparkles },
    { key: "video-gen" as Tab, label: t("dashboard.tabs.videoGen"), icon: Video },
    { key: "audio" as Tab, label: t("dashboard.tabs.audio"), icon: Mic2 },
    { key: "edit" as Tab, label: t("dashboard.tabs.edit"), icon: Scissors },
  ];

  const systemTools = [
    { key: "history" as Tab, label: t("dashboard.tabs.history"), icon: Clock },
    { key: "settings" as Tab, label: t("dashboard.tabs.settings"), icon: Settings },
    ...(canAccessAdmin ? [{ key: "admin" as Tab, label: "后台", icon: Shield }] : []),
  ];
  if (isPending || !session?.user) {
    return (
      <div className="grid h-screen place-items-center bg-[var(--color-bg-base)] px-6">
        <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5 text-sm text-[var(--color-text-secondary)] shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">{authLoadingSteps[authLoadingStep]}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">请稍候</p>
            </div>
            <Spinner size="sm" />
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-base)]">
            <div className="h-full w-2/3 rounded-full bg-[#D97757] shadow-[0_0_18px_rgba(217,119,87,0.45)] transition-all duration-700 animate-pulse" />
          </div>
          <div className="mt-4 grid gap-2">
            <div className="h-2.5 w-11/12 rounded-full bg-[var(--color-bg-base)] animate-pulse" />
            <div className="h-2.5 w-8/12 rounded-full bg-[var(--color-bg-base)] animate-pulse" />
            <div className="h-2.5 w-10/12 rounded-full bg-[var(--color-bg-base)] animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

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
                onClick={() => void handleSignOut()}
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
                <div className="flex items-center gap-2">
                  {canAccessAdmin ? (
                    <button
                      type="button"
                      onClick={() => selectTab("admin")}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#D97757] transition-colors hover:bg-[var(--color-bg-raised)]"
                    >
                      <Shield className="h-4 w-4" />
                      后台
                    </button>
                  ) : null}
                  {session?.user ? (
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-raised)] hover:text-[var(--color-text-primary)]"
                    >
                      <LogOut className="h-4 w-4" />
                      {t("auth.logout")}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="text-center mb-10 md:mb-14">
                <h1 className="text-4xl md:text-6xl font-bold tracking-normal text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                  Create with AI
                </h1>
                <p className="mt-5 text-xl md:text-2xl text-[var(--color-text-secondary)]">How would you like to get started?</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 md:gap-7">
                {featureCards.map((feature) => {
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
            <VideoWorkflowCreate onSendToGenerate={handleWorkflowSendToGenerate} />
          )}
          {/* 音频分析页面 */}
          {activeTab === "audio" && <AudioAnalyzeTab activeTab={activeTab} initialProjectId={workflowProjectId} initialVersionId={workflowVersionId} />}

          {/* 视频剪辑页面 */}
          {activeTab === "edit" && (
            <div className="animate-fade-in">
              <VideoEditTab initialProjectId={workflowProjectId} initialVersionId={workflowVersionId} initialSceneId={workflowSceneId} />
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
                initialModel={videoGenModel}
                hiddenReferenceImageUrl={hiddenSceneReferenceImageUrl}
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
              <Link href="/billing" className="inline-flex min-h-11 items-center underline underline-offset-4">{zh ? "余额、订单与任务记录" : "Balance, orders and task history"}</Link>
              <ApiKeySettings />
            </div>
          )}

          {/* 管理后台 */}
          {activeTab === "admin" && (
            <div className="animate-fade-in">
              <Link href="/billing/review" className="mb-5 inline-flex min-h-11 items-center underline underline-offset-4">{zh ? "支付对账与异常处理" : "Payment reconciliation and review"}</Link>
              <AdminOverviewPanel />
            </div>
          )}
        </div>
      </main>

      {/* 悬浮聊天助手 */}
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
