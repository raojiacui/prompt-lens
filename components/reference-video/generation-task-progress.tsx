"use client";

import React, { useEffect, useState } from "react";
import { Check, Circle, Loader2, XCircle } from "lucide-react";
import type { GenerationVariant } from "@/lib/reference-video/types";
import { generationStages, type GenerationStage } from "@/lib/reference-video/generation-progress";

const labels: Record<GenerationStage, [string, string]> = {
  preparing: ["准备任务", "Prepare task"],
  moderating: ["提示词审核", "Prompt safety check"],
  quoting: ["核算费用与素材", "Check cost and media"],
  submitting: ["提交生成任务", "Submit generation"],
  queued: ["等待后台调度", "Waiting for dispatch"],
  generating: ["模型生成", "Model generation"],
  reviewing_output: ["输出内容安全审核", "Output safety review"],
  complete: ["结果就绪", "Result ready"],
};

export function GenerationTaskProgress({ variant, zh }: { variant: GenerationVariant; zh: boolean }) {
  const progress = variant.lifecycle;
  const [now, setNow] = useState(() => Date.now());
  const terminal = variant.status === "completed" || variant.status === "failed" || variant.status === "review" || variant.trackingStopped;
  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [terminal]);
  // Older persisted tasks have no preparation checkpoints; do not invent them.
  const stage = progress?.stage ?? (variant.status === "completed" ? "complete" : variant.providerTaskId ? "generating" : "preparing");
  const interrupted = progress?.connection === "error";
  const stages = generationStages.filter(step => !["quoting", "queued"].includes(step) || progress?.commercial);
  const completed = progress?.completed ?? [];
  const elapsed = progress ? Math.max(0, Math.floor(((progress.finishedAt ?? (terminal ? progress.updatedAt : now)) - progress.startedAt) / 1000)) : undefined;
  const currentElapsed = progress ? Math.max(0, Math.floor(((progress.finishedAt ?? (terminal ? progress.updatedAt : now)) - progress.updatedAt) / 1000)) : undefined;
  const title = variant.trackingStopped ? (zh ? "已停止跟踪，结果待核实" : "Tracking stopped; result unconfirmed")
    : variant.status === "queued" ? (zh ? "等待前序任务提交" : "Waiting for earlier submissions")
    : variant.status === "failed" ? (zh ? "生成未完成" : "Generation incomplete")
    : variant.status === "review" ? (zh ? "提交状态待核实" : "Submission unconfirmed")
      : interrupted ? (zh ? "状态同步中断" : "Status sync interrupted") : labels[stage][zh ? 0 : 1];
  return <div data-testid="generation-task-progress" className="mt-3 space-y-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold text-foreground">{zh ? variant.label === "Primary output" ? "生成结果" : variant.label.replace(/^Variation (\d+)$/, "生成结果 $1") : variant.label}</p>
      {elapsed !== undefined && <span className="text-xs text-muted-foreground">{zh ? "已用时" : "Elapsed"} {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
    </div>
    <p role="status" aria-live="polite" className={variant.status === "failed" ? "font-medium text-destructive" : "font-medium text-foreground"}>{title}</p>
    <ol aria-label={zh ? "视频生成阶段" : "Video generation stages"} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {stages.map(step => {
        const active = step === stage;
        const done = (variant.status === "completed" && step === "complete") || completed.includes(step);
        const failed = active && variant.status === "failed";
        const running = active && variant.status === "generating" && !interrupted && !variant.trackingStopped;
        const Icon = failed ? XCircle : done ? Check : running ? Loader2 : Circle;
        const state = failed ? (zh ? "失败" : "Failed") : done ? (zh ? "已完成" : "Done")
          : active && (interrupted || variant.status === "review" || variant.trackingStopped) ? (zh ? "待核实" : "Unconfirmed")
            : running ? (zh ? "处理中" : "In progress")
              : generationStages.indexOf(step) < generationStages.indexOf(stage) ? (zh ? "未记录" : "Not recorded")
                : variant.trackingStopped ? (zh ? "未确认" : "Unconfirmed")
                  : terminal ? (zh ? "未执行" : "Not started") : (zh ? "等待中" : "Waiting");
        return <li key={step} aria-current={active ? "step" : undefined} className={`min-w-0 rounded-lg border p-3 ${failed ? "border-destructive/40 bg-destructive/5" : active ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <div className="flex items-center gap-2">
            <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${running ? "animate-spin motion-reduce:animate-none" : ""} ${failed ? "text-destructive" : done || active ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-medium text-foreground">{labels[step][zh ? 0 : 1]}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{state}{running && currentElapsed !== undefined ? ` · ${currentElapsed}s` : ""}</p>
        </li>;
      })}
    </ol>
    <p role={variant.status === "failed" ? "alert" : undefined} className="break-words text-xs leading-relaxed text-muted-foreground">{variant.error || variant.notes}</p>
    {variant.status === "generating" && !variant.trackingStopped && <p className="text-xs leading-relaxed text-muted-foreground">{interrupted
      ? (zh ? "保留上次确认的阶段，正在重试查询；后台任务可能仍在运行，请勿重复提交。" : "Keeping the last confirmed stage and retrying. The task may still be running; do not resubmit.")
      : stage === "generating" ? (zh ? "等待模型返回结果，当前没有可确认的生成百分比，请勿重复提交。" : "Waiting for the model result. A generation percentage is not available; do not resubmit.") : (zh ? "阶段状态由服务端实时同步。" : "Stages are reported by the server.")}</p>}
  </div>;
}
