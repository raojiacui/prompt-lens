"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  StopCircle,
  Trash2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { agentApi } from "@/lib/agent/client";
import type { AgentRunDetail } from "@/lib/agent/types";
import { runStatusLabel, taskKindLabel } from "./agent-suggestions";
import { AgentPlanTimeline } from "./agent-plan-timeline";
import { AgentArtifactPanel } from "./agent-artifact-panel";
import { AgentNextActions } from "./agent-next-actions";

interface Props {
  run: AgentRunDetail;
  onBack: () => void;
  onChanged: (run: AgentRunDetail) => void;
  onDeleted: () => void;
  onNavigateVideoGen?: (prompt: string) => void;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const IN_FLIGHT = new Set(["queued", "planning", "running"]);

export function AgentRunPanel({ run, onBack, onChanged, onDeleted, onNavigateVideoGen }: Props) {
  const [current, setCurrent] = useState<AgentRunDetail>(run);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cancel" | "retry" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCurrent(run);
  }, [run]);

  // 运行中时轮询状态（queued/planning/running）
  useEffect(() => {
    if (TERMINAL.has(current.status) || current.status === "waiting_for_user") {
      if (pollRef.current) clearTimeout(pollRef.current);
      return;
    }
    pollRef.current = setTimeout(async () => {
      try {
        const { run: updated } = await agentApi.getRun(current.id);
        setCurrent(updated);
        onChanged(updated);
      } catch (e) {
        // 401 / 网络错误时停止轮询并提示，不再空转
        if (e instanceof Error && (e.message === "Unauthorized" || e.message.includes("401"))) {
          setActionError("Your session expired. Please sign in again.");
        }
        /* 其它瞬时错误继续轮询 */
      }
    }, 1500);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [current, onChanged]);

  const inFlight = IN_FLIGHT.has(current.status);
  const usedFallback = Boolean(current.metadata?.plannerUsedFallback);

  const refresh = async () => {
    const { run: r } = await agentApi.getRun(current.id);
    setCurrent(r);
    onChanged(r);
    return r;
  };

  const handleCancel = async () => {
    setBusy("cancel");
    setActionError(null);
    try {
      const { run: r } = await agentApi.cancelRun(current.id);
      setCurrent(r);
      onChanged(r);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRetry = async () => {
    setBusy("retry");
    setActionError(null);
    try {
      const { run: r } = await agentApi.retryRun(current.id);
      setCurrent(r);
      onChanged(r);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Retry failed");
      setBusy(null);
    }
    // 注意：retry 成功后状态变为 queued，进入轮询；busy 保留到第一个非 queued 状态以显示 "Retrying…"
  };

  // retry 后台启动后，一旦状态离开 queued 就释放 busy
  useEffect(() => {
    if (busy === "retry" && current.status !== "queued") {
      setBusy(null);
    }
  }, [current.status, busy]);

  const handleDelete = async () => {
    setBusy("delete");
    setActionError(null);
    try {
      await agentApi.deleteRun(current.id);
      onDeleted();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      {/* 顶部：返回 + 状态操作 */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#D8D5CC] bg-white/70 px-3 py-1.5 text-sm font-medium text-[#6B6860] shadow-sm transition-colors hover:text-[#141413]"
        >
          <ArrowLeft className="h-4 w-4" />
          New goal
        </button>
        <div className="flex items-center gap-2">
          {inFlight && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#C0453A]/40 bg-white px-3 py-1.5 text-sm font-medium text-[#C0453A] shadow-sm transition-colors hover:bg-[#FDF1ED] disabled:opacity-50"
            >
              <StopCircle className="h-4 w-4" />
              Stop
            </button>
          )}
          {(current.status === "failed" || current.status === "cancelled") && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#D97757] px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C96848] disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", busy === "retry" && "animate-spin")} />
              {busy === "retry" ? "Retrying…" : "Retry"}
            </button>
          )}
          {confirmDelete ? (
            <div className="inline-flex items-center gap-1 rounded-full border border-[#C0453A]/40 bg-white p-0.5 pl-2 text-sm text-[#C0453A]">
              <span className="px-1">Delete this run?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy !== null}
                className="rounded-full bg-[#C0453A] px-2 py-1 text-xs font-semibold text-white hover:bg-[#A83A30] disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy !== null}
                className="rounded-full px-2 py-1 text-xs hover:bg-[#FDF1ED] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy !== null}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#9C9890] transition-colors hover:bg-[#FDF1ED] hover:text-[#C0453A] disabled:opacity-50"
              aria-label="Delete run"
              title="Delete run"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 目标卡片 */}
      <div className="mb-5 rounded-2xl border border-[#E4E2DD] bg-white/80 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#9C9890]">
          <Sparkles className="h-3.5 w-3.5 text-[#D97757]" />
          {taskKindLabel(current.taskKind)}
        </div>
        <p className="mt-2 text-lg leading-relaxed text-[#141413]">{current.goal}</p>
        <StatusBar status={current.status} usedFallback={usedFallback} />
        {current.errorMessage && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#FDF1ED] px-3 py-2 text-sm text-[#C0453A]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{current.errorMessage}</span>
          </div>
        )}
        {actionError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#FDF1ED] px-3 py-2 text-sm text-[#C0453A]">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
        {usedFallback && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#F5F3EC] px-3 py-2 text-xs text-[#6B6860]">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No LLM / search API key detected — the agent used its built-in deterministic planner and mock tools.
              Add a key in Settings to enable live research and AI planning.
            </span>
          </div>
        )}
      </div>

      {/* 计划与步骤 */}
      {current.status === "planning" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl border border-[#E4E2DD] bg-white/60 p-6 text-[#6B6860]">
            <Loader2 className="h-5 w-5 animate-spin text-[#D97757]" />
            <span className="text-sm font-medium">Planning your workflow…</span>
          </div>
          <p className="px-2 text-xs text-[#9C9890]">
            Breaking the goal into steps and choosing the right tools.
          </p>
        </div>
      ) : current.status === "queued" ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[#E4E2DD] bg-white/60 p-6 text-[#6B6860]">
          <Loader2 className="h-5 w-5 animate-spin text-[#D97757]" />
          <span className="text-sm font-medium">Starting your agent…</span>
        </div>
      ) : (
        <div className="space-y-6">
          <AgentPlanTimeline run={current} />

          {current.artifacts.length > 0 && (
            <AgentArtifactPanel run={current} onChanged={() => { void refresh(); }} />
          )}

          {current.status === "completed" && (
            <AgentNextActions
              run={current}
              onCopyPrompt={() => {}}
              onRetry={handleRetry}
              onNavigateVideoGen={onNavigateVideoGen}
            />
          )}

          {current.status === "failed" && (
            <div className="rounded-2xl border border-[#C0453A]/25 bg-[#FDF1ED]/60 p-4 text-sm text-[#8A3329]">
              <p className="font-semibold">This run did not finish.</p>
              <p className="mt-1">
                Use Retry to resume from the failed step — completed steps and artifacts are kept.
              </p>
            </div>
          )}

          {current.status === "cancelled" && (
            <div className="rounded-2xl border border-[#9C9890]/30 bg-[#F7F6F3] p-4 text-sm text-[#5F5F5B]">
              <p className="font-semibold">Run cancelled.</p>
              <p className="mt-1">You can retry to resume, or start a new goal.</p>
            </div>
          )}

          {current.status === "waiting_for_user" && (
            <div className="rounded-2xl border border-[#7A5BA6]/30 bg-[#F4EFFB] p-4 text-sm text-[#4A3370]">
              <p className="font-semibold">The agent needs your input.</p>
              <p className="mt-1">Check the next actions above (e.g. add an API key or upload media) and retry.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBar({ status, usedFallback }: { status: AgentRunDetail["status"]; usedFallback: boolean }) {
  const tone =
    status === "completed"
      ? "bg-[#E8F1E8] text-[#3F6B3E]"
      : status === "failed" || status === "cancelled"
      ? "bg-[#FDF1ED] text-[#C0453A]"
      : status === "waiting_for_user"
      ? "bg-[#F4EFFB] text-[#5B3E8A]"
      : "bg-[#FFF1E9] text-[#B85A36]";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>
        {(status === "running" || status === "planning" || status === "queued") && (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
        {runStatusLabel(status)}
      </span>
      {usedFallback && (
        <span
          className="rounded-full bg-[#F5F3EC] px-2.5 py-1 text-[11px] font-medium text-[#6B6860]"
          title="No LLM API key configured; used the built-in deterministic planner and mock tools."
        >
          Fallback planner · mock tools
        </span>
      )}
    </div>
  );
}
