"use client";

import { useState } from "react";
import { History, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRunStatus } from "@/lib/agent/types";
import type { AgentRunSummary } from "@/lib/agent/client";
import { runStatusLabel, taskKindLabel } from "./agent-suggestions";

interface Props {
  runs: AgentRunSummary[];
  loading: boolean;
  activeRunId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_DOT: Record<AgentRunStatus, string> = {
  queued: "bg-[#C8C4BC]",
  planning: "bg-[#3B6FB6] animate-pulse",
  running: "bg-[#D97757] animate-pulse",
  waiting_for_user: "bg-[#7A5BA6]",
  completed: "bg-[#5B8C5A]",
  failed: "bg-[#C0453A]",
  cancelled: "bg-[#9C9890]",
};

export function AgentRunHistory({ runs, loading, activeRunId, onSelect, onDelete }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-[#E4E2DD] bg-white/70 p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#141413]">
        <History className="h-4 w-4 text-[#D97757]" />
        Recent runs
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-[#9C9890]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : runs.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-[#9C9890]">No runs yet.</p>
          <p className="mt-1 text-xs text-[#B5B1A8]">
            Describe a goal above — your agent runs will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {runs.map((run) => {
            const isConfirming = confirmId === run.id;
            return (
              <li key={run.id}>
                <div
                  className={cn(
                    "group flex items-start gap-3 rounded-xl px-3 py-2 transition-colors",
                    activeRunId === run.id ? "bg-[#FFF1E9]" : "hover:bg-[#F8F8F7] cursor-pointer"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmId(null);
                      onSelect(run.id);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[run.status])} />
                      <span className="truncate text-sm font-medium text-[#141413]">{run.goal}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[11px] text-[#9C9890]">
                      <span>{taskKindLabel(run.taskKind)}</span>
                      <span aria-hidden>·</span>
                      <span>{runStatusLabel(run.status)}</span>
                      <span aria-hidden>·</span>
                      <span>{new Date(run.createdAt).toLocaleString()}</span>
                    </div>
                  </button>

                  {isConfirming ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(run.id);
                          setConfirmId(null);
                        }}
                        aria-label="Confirm delete"
                        className="rounded-md bg-[#C0453A] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#A83A30]"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        aria-label="Cancel delete"
                        className="rounded-md p-1 text-[#9C9890] hover:bg-[#F5F3EC]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmId(run.id);
                      }}
                      aria-label="Delete run"
                      title="Delete run"
                      className="shrink-0 rounded-md p-1.5 text-[#9C9890] opacity-0 transition-all hover:bg-[#FDF1ED] hover:text-[#C0453A] group-hover:opacity-100 focus:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
