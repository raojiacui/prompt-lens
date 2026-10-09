"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { X } from "lucide-react";
import { type SceneInterval } from "@/lib/billing/pricing-v6";
import { listModels } from "@/lib/ai/model-registry";
import { SceneVideoPreview } from "@/components/workflow/scene-video-preview";
import { ShotDownloadButton } from "@/components/workflow/shot-download-button";
import { AnalysisTaskProgress } from "./analysis-task-progress";

type AnalysisPreparation = { id: string; scenes: SceneInterval[]; durationUs: number };
type AnalysisQuoteSource = { projectId: string; mediaUrl: string; mediaName: string; outputLanguage: "zh" | "en"; automaticSplit: boolean; payer?: "platform" | "byok"; modelId?: string };

export function AnalysisQuotePanel({ source, onClose, onComplete }: { source: AnalysisQuoteSource; onClose: () => void; onComplete: (bundle: unknown) => void }) {
  const zh = useLocale() === "zh";
  const automaticSplit = source.automaticSplit;
  const payer = source.payer ?? "platform";
  const model = "flash";
  const byokModel = source.modelId || "analysis-gemini-3-8-flash";
  const selectedModelId = payer === "byok" ? byokModel : "analysis-gemini-3-8-flash";
  const modelName = listModels("analysis").find(item => item.id === selectedModelId)?.displayName || selectedModelId;
  const [preparation, setPreparation] = useState<AnalysisPreparation | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quote, setQuote] = useState<{ id: string; credits: number; splitCredits: number; analysisCredits: number; expiresAt?: string } | null>(null);
  const [taskId, setTaskId] = useState("");
  const [state, setState] = useState("");
  const [taskProgress, setTaskProgress] = useState({ phase: "preparing", total: 0, finished: 0, startedAt: 0 });
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [confirmationStarted, setConfirmationStarted] = useState(false);
  const preparationRequest = useRef<Promise<AnalysisPreparation> | null>(null);
  const [error, setError] = useState("");
  const completed = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const playingPreview = useRef<HTMLVideoElement | null>(null);
  const selectedScenes = preparation?.scenes.filter(scene => selected.includes(scene.id)) || [];
  const allSelected = Boolean(preparation && selectedScenes.length === preparation.scenes.length);
  const selectionLocked = busy || downloading || confirmationStarted;
  const selectedSeconds = selectedScenes.reduce((total, scene) => total + scene.endUs - scene.startUs, 0) / 1000000;
  const selectionKey = JSON.stringify(selected);
  const onCompleteRef = useRef(onComplete); onCompleteRef.current = onComplete;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedScenes.length > 0 && !allSelected;
  }, [selectedScenes.length, allSelected]);
  useEffect(() => () => downloadController.current?.abort(), []);
  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    const action = (body as { action?: string })?.action;
    const invalidResponse = () => new Error(url.includes("/tasks/")
      ? (zh ? "确认分析的响应中断，提交结果尚未确认。再次点击会核对同一任务，不会新建任务。" : "Confirmation response was interrupted. Retry to check the same task; no new task will be created.")
      : action === "prepare"
        ? (zh ? "读取视频信息时服务返回不完整。" : "The video inspection response was incomplete.")
        : (zh ? "费用报价响应不完整，尚未开始分析。" : "The cost response was incomplete; analysis has not started."));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw invalidResponse();
    if (!response.ok && data.code === "UPLOAD_VIDEO_TOO_LONG") throw new Error(zh ? "上传文件只支持 10 秒以内的完整单镜头片段。" : "File uploads support one complete shot up to 10 seconds.");
    if (!response.ok) throw new Error(data.code === "INSUFFICIENT_COMMERCIAL_BALANCE" ? (zh ? "可用积分不足，请先充值。" : "Not enough available credits. Please top up.") : data.code === "KIE_KEY_REQUIRED" ? (zh ? "请先配置所选来源的 KIE Key。" : "Configure the KIE key for this payment source first.") : (zh ? "暂时无法确认，请重试。任务结果不明确时，请勿重复提交。" : "Unable to confirm. Retry to check; do not resubmit an uncertain task."));
    if (typeof data.id !== "string" || !data.id) throw invalidResponse();
    if (action === "prepare" && (!Array.isArray(data.scenes) || !data.scenes.length || !Number.isSafeInteger(data.durationUs) || data.durationUs <= 0)) throw invalidResponse();
    if (action === "quote" && (![data.credits, data.splitCredits, data.analysisCredits].every(value => Number.isSafeInteger(value) && value >= 0))) throw invalidResponse();
    if (url.includes("/tasks/") && typeof data.state !== "string") throw invalidResponse();
    return data;
  }
  async function downloadShot(sceneId: string) {
    if (!preparation) throw new Error(zh ? "请先读取视频信息。" : "Inspect the video first.");
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    try {
      return await fetch(`/api/commercial/analysis/${preparation.id}/shots/${encodeURIComponent(sceneId)}`, { method: "POST", cache: "no-store", signal: controller.signal });
    } finally { if (!controller.signal.aborted) setDownloading(false); }
  }
  useEffect(() => {
    if (preparation) return;
    let cancelled = false;
    setPreparing(true);
    if (!preparationRequest.current) preparationRequest.current = post("/api/commercial/analysis", { action: "prepare", ...source, automaticSplit });
    void preparationRequest.current.then(data => {
      if (cancelled) return;
      setPreparation(data); setSelected(data.scenes.map(scene => scene.id)); setError("");
    }).catch(e => {
      if (!cancelled) { preparationRequest.current = null; setError(e instanceof Error ? e.message : "Error"); }
    }).finally(() => { if (!cancelled) setPreparing(false); });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => {
    if (!preparation || taskId || confirmationStarted) return;
    let cancelled = false;
    setQuote(null);
    if (!selected.length) { setQuoting(false); return; }
    setQuoting(true); setError("");
    const timer = setTimeout(() => {
      void post("/api/commercial/analysis", { action: "quote", preparationId: preparation.id, sceneIds: selected, payer: payer === "platform" ? "platform" : automaticSplit ? "byok_split" : "byok", model, modelId: payer === "byok" ? byokModel : undefined, outputLanguage: source.outputLanguage })
        .then(data => { if (!cancelled) setQuote(data); })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Error"); })
        .finally(() => { if (!cancelled) setQuoting(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [preparation, selectionKey, refresh, taskId, confirmationStarted, payer, byokModel, automaticSplit, source.outputLanguage]);
  function changeSelection(ids: string[]) {
    setQuote(null); setQuoting(ids.length > 0); setSelected(ids);
  }
  useEffect(() => {
    if (!quote || taskId || confirmationStarted) return;
    const remaining = quote.expiresAt ? Date.parse(quote.expiresAt) - Date.now() - 30000 : 9 * 60000;
    const timer = setTimeout(() => { setQuote(null); setQuoting(true); setRefresh(value => value + 1); }, Math.max(1000, remaining));
    return () => clearTimeout(timer);
  }, [quote, taskId, confirmationStarted]);
  async function confirmAnalysis() {
    if (busy || quoting || !quote) return;
    setConfirmationStarted(true);
    setBusy(true); setError("");
    try {
        // Keep the same server quote ID even when the confirmation response is lost.
        const data = await post(`/api/commercial/tasks/${quote.id}`, {});
        setTaskProgress({ phase: "preparing", total: selectedScenes.length, finished: 0, startedAt: Date.now() });
        setTaskId(data.id); setState(data.state);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!taskId || completed.current) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/commercial/tasks/${taskId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (controller.signal.aborted) return;
        setState(data.state);
        setError("");
        setTaskProgress(previous => ({ ...previous, phase: data.phase || previous.phase, total: data.totalScenes ?? previous.total, finished: data.completedScenes ?? previous.finished }));
        if (["completed", "failed"].includes(data.state) && data.bundle && !completed.current) { completed.current = true; onCompleteRef.current(data.bundle); }
        if (["completed", "failed", "review"].includes(data.state)) return;
      } catch { if (!controller.signal.aborted) setError(zh ? "查询暂时中断，任务仍保留在账户中。" : "Status temporarily unavailable. Your task remains in your account."); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [taskId, zh]);
  return <section aria-labelledby="analysis-quote-title" className="min-h-0 flex-1 overflow-y-auto p-1 text-foreground">
    <header className="flex items-start justify-between gap-4"><h2 id="analysis-quote-title" className="text-xl font-semibold">{zh ? "镜头选择与费用" : "Shots and analysis cost"}</h2>{!taskId && <button disabled={busy || confirmationStarted} onClick={onClose} title={zh ? "返回素材选择" : "Back to reference"} aria-label={zh ? "返回素材选择" : "Back to reference"} className="flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-50"><X size={18} /></button>}</header>
    <p className="mt-3 truncate text-sm text-muted-foreground">{source.mediaName}</p>
    {!taskId && <>
      <p className="mt-3 text-sm text-muted-foreground">{modelName} · {payer === "platform" ? (zh ? "平台积分" : "Platform credits") : (zh ? "自带 Key" : "Own key")}</p>
      <p className="mt-3 text-sm">{automaticSplit ? (zh ? "链接视频：先拆镜，再选择镜头分析。" : "Linked video: split first, then select shots to analyze.") : (zh ? "上传文件：单镜头分析，不收拆镜费。" : "Uploaded file: single-shot analysis, no splitting fee.")}</p>
      {preparation && <div className="mt-5">
        <p className="mb-3 text-sm">{(preparation.durationUs / 1000000).toFixed(2)}s · {preparation.scenes.length} {zh ? "个镜头" : "shots"}</p>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex min-h-11 items-center gap-2"><input ref={selectAll} type="checkbox" checked={allSelected} disabled={selectionLocked} onChange={e => changeSelection(e.target.checked ? preparation.scenes.map(scene => scene.id) : [])} />{zh ? "全选" : "Select all"}</label>
          <span role="status" className="text-muted-foreground">{zh ? `已选 ${selectedScenes.length}/${preparation.scenes.length} 个镜头 · ${selectedSeconds.toFixed(2)} 秒` : `${selectedScenes.length}/${preparation.scenes.length} shots selected · ${selectedSeconds.toFixed(2)} sec`}</span>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-2">{preparation.scenes.map((scene, index) => <article key={scene.id} aria-label={zh ? `镜头 ${index + 1}` : `Shot ${index + 1}`} className="rounded-lg border border-border bg-background p-3 sm:p-4">
          <div className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-9 cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" aria-label={zh ? `镜头 ${index + 1}` : `Shot ${index + 1}`} checked={selected.includes(scene.id)} disabled={selectionLocked} onChange={(e) => changeSelection(e.target.checked ? [...selected, scene.id] : selected.filter((id) => id !== scene.id))} />
                <h3 className="text-base font-semibold">{zh ? "镜头" : "Shot"} {String(index + 1).padStart(2, "0")}</h3>
              </label>
              <span className="text-xs text-muted-foreground">{zh ? "待分析" : "Not analyzed"}</span>
              </div>
              <ShotDownloadButton zh={zh} sceneIndex={index + 1} disabled={busy || downloading} onDownload={() => downloadShot(scene.id)} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{(scene.startUs / 1000000).toFixed(2)}–{(scene.endUs / 1000000).toFixed(2)}s · {((scene.endUs - scene.startUs) / 1000000).toFixed(2)}s</p>
          </div>
          <SceneVideoPreview mediaUrl={source.mediaUrl} startUs={scene.startUs} endUs={scene.endUs} clipRequestUrl={automaticSplit ? `/api/commercial/analysis/${preparation.id}/shots/${encodeURIComponent(scene.id)}` : undefined} label={zh ? `镜头 ${index + 1} 预览` : `Shot ${index + 1} preview`} zh={zh} onPlay={(video) => {
            if (playingPreview.current !== video) playingPreview.current?.pause();
            playingPreview.current = video;
          }} />
        </article>)}</div>
        {!selectedScenes.length && <p className="mt-2 text-sm text-muted-foreground">{zh ? "请至少选择一个镜头。" : "Select at least one shot."}</p>}
      </div>}
      {quote && <div className="my-5 border-y border-border py-4"><p className="text-2xl font-semibold">{quote.credits} {zh ? "积分" : "credits"}</p><p className="mt-2 text-sm text-muted-foreground">{zh ? `拆镜 ${quote.splitCredits} + 分析 ${quote.analysisCredits}。按成功结果结算。` : `Splitting ${quote.splitCredits} + analysis ${quote.analysisCredits}. Settled by successful results.`}</p>{payer === "byok" && <p className="mt-2 text-sm">{zh ? "模型费用由你的 KIE 账户承担。" : "Model fees are billed to your KIE account."}</p>}</div>}
      <div className="mt-5 flex gap-3">
        <button disabled={busy || downloading || preparing || quoting || !quote} onClick={() => void confirmAnalysis()} className="min-h-11 min-w-0 rounded-lg bg-foreground px-3 py-1 text-sm font-semibold leading-tight text-background disabled:opacity-50">{busy ? (zh ? "正在提交…" : "Submitting…") : preparing ? (zh ? "正在读取视频…" : "Inspecting video…") : quoting ? (zh ? "正在计算费用…" : "Calculating cost…") : quote ? (zh ? `确认分析 · ${quote.credits} 积分` : `Confirm analysis · ${quote.credits} credits`) : (zh ? "确认分析" : "Confirm analysis")}</button>
      </div>
    </>}
    {taskId && <AnalysisTaskProgress zh={zh} state={state} phase={taskProgress.phase} total={taskProgress.total} finished={taskProgress.finished} startedAt={taskProgress.startedAt} />}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </section>;
}
