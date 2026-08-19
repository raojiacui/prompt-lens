"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Maximize2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { AgentComposer } from "./agent-composer";
import { AgentRunPanel } from "./agent-run-panel";
import { AgentRunHistory } from "./agent-run-history";
import { agentApi, type AgentRunSummary } from "@/lib/agent/client";
import type { AgentAttachment, AgentRunDetail } from "@/lib/agent/types";

const LAST_RUN_KEY = "promptlens:lastAgentRunId";

const AGENT_BACKGROUNDS = [
  {
    label: "Spring morning",
    url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=85",
    position: "center 48%",
  },
  {
    label: "Summer noon",
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1800&q=85",
    position: "center 52%",
  },
  {
    label: "Autumn afternoon",
    url: "https://images.unsplash.com/photo-1508264165352-258db2ebd59b?auto=format&fit=crop&w=1800&q=85",
    position: "center 50%",
  },
  {
    label: "Winter night",
    url: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1800&q=85",
    position: "center 45%",
  },
];

function getAgentBackgroundForHour(hour: number) {
  if (hour >= 5 && hour < 10) return AGENT_BACKGROUNDS[0];
  if (hour >= 10 && hour < 15) return AGENT_BACKGROUNDS[1];
  if (hour >= 15 && hour < 19) return AGENT_BACKGROUNDS[2];
  return AGENT_BACKGROUNDS[3];
}
interface Props {
  /** 当用户在 next actions 里选择"生成视频"时，把 prompt 交给 dashboard 跳转 video-gen tab */
  onNavigateVideoGen?: (prompt: string) => void;
}

function isUnauthorized(e: unknown): boolean {
  return e instanceof Error && (e.message === "Unauthorized" || /\b401\b/.test(e.message));
}

export function CreateWithAgent({ onNavigateVideoGen }: Props) {
  const router = useRouter();
  const [activeRun, setActiveRun] = useState<AgentRunDetail | null>(null);
  const [history, setHistory] = useState<AgentRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [composerLoading, setComposerLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [agentBackground, setAgentBackground] = useState(AGENT_BACKGROUNDS[1]);
  const [launchingRun, setLaunchingRun] = useState<{ id: string; goal: string } | null>(null);

  useEffect(() => {
    setAgentBackground(getAgentBackgroundForHour(new Date().getHours()));
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const { runs } = await agentApi.listRuns(10);
      setHistory(runs);
    } catch (e) {
      // 401 等错误不显示在首页历史区，只静默（未登录用户看不到 agent 区块是预期）
      if (isUnauthorized(e)) {
        setNeedsAuth(true);
      }
      // 其它错误保留已有历史，不阻塞页面
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 初始加载：历史 + 恢复上次 run
  useEffect(() => {
    void refreshHistory();
    try {
      const lastId =
        typeof window !== "undefined" ? window.localStorage.getItem(LAST_RUN_KEY) : null;
      if (lastId) {
        setRestoring(true);
        agentApi
          .getRun(lastId)
          .then(({ run }) => setActiveRun(run))
          .catch(() => {
            // 上次 run 已不存在/无权限，清理
            if (typeof window !== "undefined") window.localStorage.removeItem(LAST_RUN_KEY);
          })
          .finally(() => setRestoring(false));
      }
    } catch {
      /* localStorage may be unavailable */
      setRestoring(false);
    }
  }, [refreshHistory]);

  const persistLastRun = (run: AgentRunDetail) => {
    try {
      window.localStorage.setItem(LAST_RUN_KEY, run.id);
    } catch {
      /* ignore */
    }
  };

  const handleSubmit = async (goal: string, attachments: AgentAttachment[]) => {
    setPageError(null);
    setNeedsAuth(false);
    setComposerLoading(true);
    try {
      // 透传当前页面语言（cookie 由后端读取，这里把 navigator 语言作为参考）
      const locale =
        typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en";
      const { run } = await agentApi.createRun({ userGoal: goal, attachments, locale });
      persistLastRun(run);
      setLaunchingRun({ id: run.id, goal });
      void refreshHistory();
      window.setTimeout(() => {
        router.push(`/agent/${run.id}`);
      }, 620);
    } catch (e) {
      if (isUnauthorized(e)) {
        setNeedsAuth(true);
        setPageError("Please sign in to use the agent.");
      } else {
        setPageError(e instanceof Error ? e.message : "Could not start the agent. Please try again.");
      }
    } finally {
      setComposerLoading(false);
    }
  };

  const handleSelectRun = async (id: string) => {
    setPageError(null);
    try {
      const { run } = await agentApi.getRun(id);
      setActiveRun(run);
      persistLastRun(run);
    } catch (e) {
      setPageError(
        isUnauthorized(e) ? "Please sign in to view this run." : "Could not load this run."
      );
    }
  };

  const handleRunChanged = useCallback(
    (run: AgentRunDetail) => {
      setActiveRun(run);
      void refreshHistory();
    },
    [refreshHistory]
  );

  const handleRunDeleted = useCallback(async () => {
    if (activeRun) {
      try {
        await agentApi.deleteRun(activeRun.id);
      } catch {
        /* ignore */
      }
    }
    setActiveRun(null);
    try {
      window.localStorage.removeItem(LAST_RUN_KEY);
    } catch {
      /* ignore */
    }
    void refreshHistory();
  }, [activeRun, refreshHistory]);

  const handleBack = () => {
    setActiveRun(null);
  };

  return (
    <section
      aria-label="Create with Agent"
      className="mx-auto w-full max-w-[1080px] pb-8 pt-1 md:pt-2"
    >
      {launchingRun && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--color-bg-base)] agent-launch-sheet" aria-live="polite">
          <div className="w-[min(760px,calc(100vw-32px))] rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-raised)] px-7 py-6 shadow-[0_28px_90px_rgba(44,24,24,0.16)]">
            <div className="flex items-center justify-between gap-4">
              <p className="text-2xl font-bold text-[var(--color-text-primary)]">Agent</p>
              <div className="h-2.5 w-2.5 rounded-full bg-[#5B2DFF]" />
            </div>
            <div className="mt-7 flex justify-end">
              <div className="max-w-[78%] rounded-2xl bg-[var(--color-bg-base)] px-4 py-3 text-sm font-semibold text-[var(--color-text-secondary)] shadow-sm">
                {launchingRun.goal}
              </div>
            </div>
            <div className="mt-8 text-sm font-semibold text-[#5F5F5B]">Opening your agent chat...</div>
          </div>
        </div>
      )}

      {pageError && (
        <div className="mx-auto mb-5 flex max-w-3xl items-start gap-2 rounded-2xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Agent unavailable</p>
            <p className="mt-0.5">{pageError}</p>
            {needsAuth && (
              <Link
                href="/login"
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent-orange)] hover:underline"
              >
                Sign in →
              </Link>
            )}
          </div>
        </div>
      )}

      {!activeRun ? (
        <div className="space-y-3">
          <div className="mx-auto flex w-full max-w-[1080px] items-center gap-5 text-[var(--color-text-secondary)]">
            <span className="h-px flex-1 border-t border-dashed border-[var(--color-border-default)]" />
            <span className="shrink-0 text-sm font-semibold md:text-base">Or try something new</span>
            <span className="h-px flex-1 border-t border-dashed border-[var(--color-border-default)]" />
          </div>

          <div
            className="relative mx-auto flex min-h-[48px] w-full max-w-[1080px] overflow-hidden rounded-[18px] bg-[#263532] px-4 py-1.5 shadow-[0_14px_36px_rgba(42,57,52,0.16)] md:min-h-[56px] md:px-5"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(50, 59, 63, 0.52), rgba(8, 18, 22, 0.38)), url(${agentBackground.url})`,
              backgroundPosition: agentBackground.position,
              backgroundSize: "cover",
            }}
            aria-label={`Create with Agent, ${agentBackground.label} background`}
          >
            <button
              type="button"
              aria-label="Expand agent composer"
              className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/12 hover:text-white"
            >
              <Maximize2 className="h-3 w-3" />
            </button>

            <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center justify-center text-center">
              <h2 className="text-sm font-bold text-white md:text-base" style={{ fontFamily: "var(--font-display)" }}>
                Create with Agent
              </h2>
              <p className="mt-0.5 max-w-2xl text-[10px] font-medium leading-tight text-white/88 md:text-[11px]">
                Turn your ideas, notes and files into presentations, docs and social posts. Agent does the research, cites its sources and shapes the narrative.
              </p>

              <div className="mt-1 w-full rounded-[14px] bg-[#4E5754]/52 p-1 shadow-[0_8px_18px_rgba(0,0,0,0.18)] backdrop-blur-lg">
                {restoring && (
                  <div className="mx-auto mb-4 flex max-w-3xl items-center justify-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    <RotateCcw className="h-3 w-3" />
                    Restoring your last run…
                  </div>
                )}
                <AgentComposer onSubmit={handleSubmit} loading={composerLoading} variant="overlay" />
              </div>

              {composerLoading && (
                <div className="mx-auto mt-5 flex max-w-3xl items-center justify-center gap-2 text-sm font-medium text-white/86">
                  <Loader2 className="h-4 w-4 animate-spin text-[#9BD1FF]" />
                  Creating your agent run…
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto max-w-3xl">
            <AgentRunHistory
              runs={history}
              loading={historyLoading}
              onSelect={handleSelectRun}
              onDelete={(id) => {
                agentApi.deleteRun(id).then(() => refreshHistory()).catch(() => {});
              }}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <AgentRunPanel
            run={activeRun}
            onBack={handleBack}
            onChanged={handleRunChanged}
            onDeleted={handleRunDeleted}
            onNavigateVideoGen={onNavigateVideoGen}
          />
          <aside className="hidden lg:block">
            <AgentRunHistory
              runs={history}
              loading={historyLoading}
              activeRunId={activeRun.id}
              onSelect={handleSelectRun}
              onDelete={(id) => {
                agentApi.deleteRun(id).then(() => refreshHistory()).catch(() => {});
              }}
            />
          </aside>
        </div>
      )}
    </section>
  );
}
