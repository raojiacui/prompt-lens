"use client";
import React, { useEffect, useState } from "react";
import type { AnalysisDiagnostics, AnalysisStage } from "@/lib/billing/analysis-diagnostics";

const labels: Record<AnalysisStage, [string, string]> = {
  quoted: ["等待确认", "Awaiting confirmation"], queued: ["等待调度", "Waiting for a worker"],
  preparing: ["准备镜头素材", "Preparing shot media"], analyzing: ["等待模型返回", "Waiting for model response"],
  saving: ["保存结果与结算", "Saving results and settling"], completed: ["已完成", "Completed"],
  failed: ["未完成", "Failed"], review: ["等待核对", "Needs review"],
};
export const analysisStageLabel = (stage: AnalysisStage, zh: boolean) => labels[stage]?.[zh ? 0 : 1] || stage;
const elapsed = (ms?: number) => ms === undefined ? "—" : `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;

export function AnalysisTaskDetails({ taskId, diagnostics, zh, lastSyncedAt, connection = "ok", expanded = false }: {
  taskId: string; diagnostics?: AnalysisDiagnostics; zh: boolean; lastSyncedAt?: number;
  connection?: "ok" | "error" | "auth"; expanded?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const time = (value?: number) => value === undefined ? "—" : new Date(value).toLocaleTimeString(zh ? "zh-CN" : "en-GB", { hour12: false });
  const active = diagnostics && !["quoted", "completed", "failed", "review"].includes(diagnostics.state);
  // A checkpoint is evidence of a state change, not a worker heartbeat.
  const oldCheckpoint = active && diagnostics.updatedAt !== undefined && diagnostics.observedAt - diagnostics.updatedAt > 120000;
  const staleView = connection !== "ok" || Boolean(active && lastSyncedAt && now - lastSyncedAt > 30000);
  return <details open={expanded || undefined} className="mt-6 rounded-lg border border-border p-4" data-testid="analysis-task-details">
    <summary className="cursor-pointer text-sm font-semibold">{zh ? "后台任务详情" : "Background task details"}{diagnostics && ` · ${analysisStageLabel(diagnostics.stage, zh)}`}</summary>
    <div className="mt-4 space-y-4 text-sm">
      <p className="break-all text-xs text-muted-foreground">{zh ? "任务 ID" : "Task ID"}: {taskId}</p>
      <p className={staleView ? "text-red-700" : "text-muted-foreground"} role={staleView ? "alert" : undefined}>{connection === "auth"
        ? (zh ? "登录校验失败，当前显示的是上次记录，无法确认后台进展。请重新登录后查看此任务。" : "Session check failed. Showing the last snapshot; background progress is unconfirmed. Sign in again to view this task.")
        : staleView ? (zh ? "状态同步中断，当前显示的是上次记录，无法确认后台是否仍在运行。" : "Status sync interrupted. Showing the last snapshot; worker activity is unconfirmed.")
        : (zh ? `最近同步 ${time(lastSyncedAt)} · 每 4–5 秒查询` : `Last synced ${time(lastSyncedAt)} · checked every 4–5 seconds`)}</p>
      {diagnostics ? <>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <dt className="text-muted-foreground">{zh ? "当前阶段" : "Stage"}</dt><dd>{analysisStageLabel(diagnostics.stage, zh)}</dd>
          <dt className="text-muted-foreground">{zh ? "模型" : "Model"}</dt><dd className="break-all">{diagnostics.modelId || "—"}</dd>
          <dt className="text-muted-foreground">{zh ? "任务创建" : "Created"}</dt><dd>{time(diagnostics.createdAt)}</dd>
          <dt className="text-muted-foreground">{zh ? "后台最近更新" : "Last checkpoint"}</dt><dd>{time(diagnostics.updatedAt)}</dd>
        </dl>
        {oldCheckpoint && <p className="text-amber-800">{zh ? "后台超过 2 分钟没有新检查点。可能正在等待素材或模型，也可能执行已中断；请结合镜头状态与错误码判断。" : "No new checkpoint for over 2 minutes. Media or model work may still be pending, or execution may have stopped. Check the shot states and error codes."}</p>}
        {diagnostics.errorCode && <p className="break-all text-red-700">{zh ? "错误码" : "Error code"}: {diagnostics.errorCode}</p>}
        <p className="text-xs text-muted-foreground">{zh ? "运行顺序：确认与预留积分 → 调度 → 各镜头准备素材、调用模型、保存结果 → 结算。最多同时处理 2 个镜头。" : "Flow: confirm and reserve credits → dispatch → prepare, analyze and save each shot → settle. Up to 2 shots run concurrently."}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs">
          <caption className="sr-only">{zh ? "逐镜头后台状态与耗时" : "Per-shot worker status and timing"}</caption>
          <thead className="border-b border-border text-muted-foreground"><tr>{(zh ? ["镜头", "后台阶段", "排队", "素材", "模型", "保存"] : ["Shot", "Stage", "Queue", "Media", "Model", "Save"]).map(text => <th key={text} scope="col" className="px-2 py-2 font-medium">{text}</th>)}</tr></thead>
          <tbody>{diagnostics.scenes.map(scene => <tr key={scene.index} className="border-b border-border last:border-0">
            <th scope="row" className="px-2 py-3 font-medium">{String(scene.index).padStart(2, "0")}</th>
            <td className="px-2 py-3">{analysisStageLabel(scene.stage, zh)}{scene.startedAt && ["preparing", "analyzing", "saving"].includes(scene.stage) && <span className="ml-2 text-muted-foreground">{elapsed((staleView ? diagnostics.observedAt : diagnostics.observedAt + Math.max(0, now - (lastSyncedAt || now))) - scene.startedAt)}</span>}{scene.errorCode && <span className="mt-1 block text-red-700">{scene.errorCode}</span>}</td>
            {[scene.queueMs, scene.preparationMs, scene.modelMs, scene.saveMs].map((ms, i) => <td key={i} className="px-2 py-3 tabular-nums">{elapsed(ms)}</td>)}
          </tr>)}</tbody>
        </table></div>
        <p className="text-xs text-muted-foreground">{zh ? "可左右滑动查看全部耗时。— 表示尚无记录；历史任务可能缺少分阶段记录。" : "Scroll horizontally for all timings. — means no recorded value; older tasks may have incomplete stage data."}</p>
      </> : <p className="text-muted-foreground">{zh ? "正在读取后台记录…" : "Loading worker records…"}</p>}
      <a href={`/billing/tasks/${encodeURIComponent(taskId)}`} target="_blank" rel="noreferrer" className="inline-block underline underline-offset-4">{zh ? "在独立页面查看此任务" : "Open this task in a separate page"}</a>
    </div>
  </details>;
}
