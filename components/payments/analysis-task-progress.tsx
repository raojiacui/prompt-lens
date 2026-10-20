"use client";
import React, { useEffect, useState } from "react";

const ANALYSIS_RANGE_START = 20;
const ANALYSIS_RANGE_END = 90;
const ESTIMATED_SHOT_SECONDS = 180;

function roundedPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function estimatedCheckpointFraction(elapsedSeconds: number) {
  const steady = Math.min(elapsedSeconds, ESTIMATED_SHOT_SECONDS) / ESTIMATED_SHOT_SECONDS * 0.78;
  const longTail = Math.min(Math.max(0, elapsedSeconds - ESTIMATED_SHOT_SECONDS), 600) / 600 * 0.12;
  return Math.min(0.9, steady + longTail);
}

export function getAnalysisProgressPercent({ state, phase, total, finished, elapsedSinceCheckpoint }: {
  state: string; phase: string; total: number; finished: number; elapsedSinceCheckpoint: number;
}) {
  if (state === "completed") return 100;
  const terminal = ["failed", "review"].includes(state);
  const count = Math.max(1, total);
  const done = Math.min(count, Math.max(0, finished));
  const checkpointElapsed = Math.max(0, elapsedSinceCheckpoint);

  if (phase === "saving") {
    if (terminal) return 95;
    return roundedPercent(95 + Math.min(checkpointElapsed / 30, 1) * 3.5);
  }
  if (phase === "analyzing") {
    const confirmed = ANALYSIS_RANGE_START + (ANALYSIS_RANGE_END - ANALYSIS_RANGE_START) * done / count;
    if (terminal || done >= count) return roundedPercent(confirmed);
    const oneShotRange = (ANALYSIS_RANGE_END - ANALYSIS_RANGE_START) / count;
    return roundedPercent(confirmed + oneShotRange * estimatedCheckpointFraction(checkpointElapsed));
  }
  if (terminal) return 0;
  return roundedPercent(2 + Math.min(checkpointElapsed / 120, 1) * 16);
}

export function AnalysisTaskProgress({ zh, state, phase, total, finished, startedAt, checkpointAt }: {
  zh: boolean; state: string; phase: string; total: number; finished: number; startedAt: number; checkpointAt?: number;
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
  const elapsedSinceCheckpoint = Math.max(0, (now - (checkpointAt || startedAt)) / 1000);
  const count = Math.max(1, total);
  const done = Math.min(count, Math.max(0, finished));
  // Server checkpoints define the floor. The current stage advances smoothly but
  // never reaches the next checkpoint until the server confirms it.
  const percent = getAnalysisProgressPercent({ state, phase, total, finished, elapsedSinceCheckpoint });
  const label = state === "review" ? (zh ? "任务需要核对" : "Task needs review")
    : state === "failed" ? (zh ? "分析未完成" : "Analysis incomplete")
    : state === "completed" ? (zh ? "分析完成" : "Analysis complete")
    : phase === "saving" ? (zh ? "正在保存分析结果" : "Saving results")
    : phase === "analyzing" ? (zh ? "正在分析镜头" : "Analyzing shots")
    : (zh ? "正在准备镜头素材" : "Preparing shot media");
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");
  return <div className="mt-6 space-y-3" data-testid="analysis-task-progress">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p role="status" className="font-semibold">{label}</p>
      <span className="text-muted-foreground">{zh ? `已处理 ${done}/${total} 个镜头` : `${done}/${total} shots processed`}</span>
    </div>
    <div role="progressbar" aria-label={zh ? "分析进度" : "Analysis progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded bg-muted">
      <div className="h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${percent}%` }} />
    </div>
    <p className="text-sm text-muted-foreground">{zh ? `已等待 ${minutes}:${seconds}` : `Elapsed ${minutes}:${seconds}`}</p>
    {!terminal && <p className="text-sm text-muted-foreground">{elapsed > count * 180 + 60
      ? (zh ? "等待已超过参考时间，仍在查询任务状态，请勿重复提交。" : "Taking longer than estimated. Still checking status; do not resubmit.")
      : (zh ? `预计约 ${count}–${count * 3 + 1} 分钟（参考估计，受素材处理及模型响应影响）。` : `Estimated ${count}–${count * 3 + 1} minutes (approximate; media processing and model response may vary).`)}</p>}
    {state === "review" && <p className="text-sm">{zh ? "额度保持预留，不会重复扣款。" : "Credits remain reserved and will not be charged twice."}</p>}
    {state === "failed" && <p className="text-sm">{zh ? "请到分析历史查看结果和任务状态。" : "Check analysis history for results and task status."}</p>}
  </div>;
}
