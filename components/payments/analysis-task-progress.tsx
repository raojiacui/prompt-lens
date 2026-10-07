"use client";
import React, { useEffect, useState } from "react";

export function AnalysisTaskProgress({ zh, state, phase, total, finished, startedAt }: {
  zh: boolean; state: string; phase: string; total: number; finished: number; startedAt: number;
}) {
  const [now, setNow] = useState(startedAt);
  const terminal = ["completed", "failed", "review"].includes(state);
  useEffect(() => {
    if (terminal) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, terminal]);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const count = Math.max(1, total);
  const done = Math.min(count, Math.max(0, finished));
  // Progress advances at server checkpoints, never with the elapsed-time estimate.
  const percent = state === "completed" ? 100 : phase === "saving" ? 95 : phase === "analyzing" ? Math.min(90, 20 + Math.floor(70 * done / count)) : 0;
  const label = state === "review" ? (zh ? "任务需要核对" : "Task needs review")
    : state === "failed" ? (zh ? "分析未完成" : "Analysis incomplete")
    : state === "completed" ? (zh ? "分析完成" : "Analysis complete")
    : phase === "saving" ? (zh ? "正在保存分析结果" : "Saving results")
    : phase === "analyzing" ? (zh ? `正在分析镜头 ${Math.min(count, done + 1)}/${count}` : `Analyzing shot ${Math.min(count, done + 1)}/${count}`)
    : (zh ? "正在准备镜头素材" : "Preparing shot media");
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");
  return <div className="mt-6 space-y-3" data-testid="analysis-task-progress">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p role="status" className="font-semibold">{label}</p>
      <span className="text-muted-foreground">{zh ? `已处理 ${done}/${total} 个镜头` : `${done}/${total} shots processed`}</span>
    </div>
    <div role="progressbar" aria-label={zh ? "分析进度" : "Analysis progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded bg-muted">
      <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
    <p className="text-sm text-muted-foreground">{zh ? `已等待 ${minutes}:${seconds}` : `Elapsed ${minutes}:${seconds}`}</p>
    {!terminal && <p className="text-sm text-muted-foreground">{elapsed > count * 180 + 60
      ? (zh ? "等待已超过参考时间，仍在查询任务状态，请勿重复提交。" : "Taking longer than estimated. Still checking status; do not resubmit.")
      : (zh ? `预计约 ${count}–${count * 3 + 1} 分钟（参考估计，受素材处理及模型响应影响）。` : `Estimated ${count}–${count * 3 + 1} minutes (approximate; media processing and model response may vary).`)}</p>}
    {state === "review" && <p className="text-sm">{zh ? "额度保持预留，不会重复扣款。" : "Credits remain reserved and will not be charged twice."}</p>}
    {state === "failed" && <p className="text-sm">{zh ? "请到分析历史查看结果和任务状态。" : "Check analysis history for results and task status."}</p>}
  </div>;
}
