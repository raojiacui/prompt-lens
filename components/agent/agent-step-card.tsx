"use client";

import { Check, ChevronDown, Loader2, AlertCircle, SkipForward } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentStep, AgentToolCall } from "@/lib/agent/types";

interface Props {
  step: AgentStep;
  toolCalls: AgentToolCall[];
  isLast: boolean;
}

const STATUS_STYLES: Record<string, { dot: string; ring: string; label: string }> = {
  queued: { dot: "bg-[#C8C4BC]", ring: "ring-[#D8D5CC]", label: "text-[#9C9890]" },
  running: { dot: "bg-[#D97757] animate-pulse", ring: "ring-[#D97757]/40", label: "text-[#D97757]" },
  completed: { dot: "bg-[#5B8C5A]", ring: "ring-[#5B8C5A]/30", label: "text-[#5B8C5A]" },
  failed: { dot: "bg-[#C0453A]", ring: "ring-[#C0453A]/30", label: "text-[#C0453A]" },
  skipped: { dot: "bg-[#C8C4BC]", ring: "ring-[#D8D5CC]", label: "text-[#9C9890]" },
  cancelled: { dot: "bg-[#9C9890]", ring: "ring-[#9C9890]/30", label: "text-[#9C9890]" },
};

function StatusIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D97757]" />;
  if (status === "completed") return <Check className="h-3.5 w-3.5 text-white" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-white" />;
  if (status === "skipped") return <SkipForward className="h-3.5 w-3.5 text-white" />;
  return null;
}

export function AgentStepCard({ step, toolCalls, isLast }: Props) {
  const [open, setOpen] = useState(step.status === "failed" || step.status === "running");
  const style = STATUS_STYLES[step.status] || STATUS_STYLES.queued;
  const calls = toolCalls.filter((c) => c.stepId === step.id);

  return (
    <div className="relative flex gap-4">
      {/* 时间线竖线 */}
      {!isLast && (
        <div
          className={cn(
            "absolute left-[15px] top-9 h-[calc(100%-20px)] w-px",
            step.status === "completed" ? "bg-[#5B8C5A]/40" : "bg-[#D8D5CC]"
          )}
          aria-hidden
        />
      )}

      {/* 状态圆点 */}
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-offset-0",
            style.ring,
            step.status === "queued"
              ? "border border-[#D8D5CC] bg-white"
              : step.status === "completed"
              ? "bg-[#5B8C5A]"
              : step.status === "failed"
              ? "bg-[#C0453A]"
              : step.status === "skipped" || step.status === "cancelled"
              ? "bg-[#C8C4BC]"
              : "bg-white"
          )}
        >
          <StatusIcon status={step.status} />
        </div>
      </div>

      {/* 卡片 */}
      <div className="min-w-0 flex-1 pb-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start gap-3 rounded-2xl border border-[#E4E2DD] bg-white/70 px-4 py-3.5 text-left shadow-sm transition-colors hover:bg-white"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9C9890]">
                Step {step.order + 1}
              </span>
              {step.toolName && (
                <code className="rounded-md bg-[#F5F3EC] px-1.5 py-0.5 text-[11px] font-medium text-[#6B6860]">
                  {step.toolName}
                </code>
              )}
              <span className={cn("text-xs font-medium", style.label)}>{step.status}</span>
            </div>
            <h4 className="mt-1 text-base font-semibold text-[#141413]">{step.title}</h4>
            <p className="mt-0.5 text-sm leading-relaxed text-[#6B6860]">{step.description}</p>
            {step.outputSummary && step.status === "completed" && (
              <p className="mt-2 line-clamp-2 rounded-lg bg-[#F8F8F7] px-3 py-1.5 text-xs text-[#5F5F5B]">
                {step.outputSummary}
              </p>
            )}
            {step.errorMessage && (
              <p className="mt-2 rounded-lg bg-[#FDF1ED] px-3 py-1.5 text-xs text-[#C0453A]">
                {step.errorMessage}
              </p>
            )}
          </div>
          {(calls.length > 0 || step.expectedOutput) && (
            <ChevronDown
              className={cn(
                "mt-1 h-4 w-4 shrink-0 text-[#9C9890] transition-transform",
                open && "rotate-180"
              )}
            />
          )}
        </button>

        {open && (calls.length > 0 || step.expectedOutput) && (
          <div className="mt-2 space-y-2 pl-1">
            {step.expectedOutput && (
              <div className="rounded-xl border border-dashed border-[#D8D5CC] bg-white/50 px-3 py-2 text-xs text-[#6B6860]">
                <span className="font-semibold text-[#141413]">Expected: </span>
                {step.expectedOutput}
              </div>
            )}
            {calls.map((call) => (
              <ToolCallItem key={call.id} call={call} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallItem({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-[#E4E2DD] bg-white/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {call.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-[#D97757]" />}
          {call.status === "completed" && <Check className="h-3 w-3 text-[#5B8C5A]" />}
          {call.status === "failed" && <AlertCircle className="h-3 w-3 text-[#C0453A]" />}
          <code className="text-xs font-semibold text-[#141413]">{call.toolName}</code>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-[#9C9890]">{call.status}</span>
      </div>
      {call.errorMessage && <p className="mt-1 text-xs text-[#C0453A]">{call.errorMessage}</p>}
      {call.output && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[11px] font-medium text-[#D97757] hover:underline"
        >
          {expanded ? "Hide output" : "Show output"}
        </button>
      )}
      {expanded && call.output && (
        <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-[#141413] p-3 text-[11px] leading-relaxed text-[#E8E6E0]">
          {JSON.stringify(call.output, null, 2)}
        </pre>
      )}
    </div>
  );
}
