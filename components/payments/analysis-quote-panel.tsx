"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { X } from "lucide-react";
import { quoteAnalysis, type SceneInterval } from "@/lib/billing/pricing-v6";
import { listModels } from "@/lib/ai/model-registry";
import { SceneVideoPreview } from "@/components/workflow/scene-video-preview";

export function AnalysisQuotePanel({ source, onClose, onComplete }: { source: { projectId: string; mediaUrl: string; mediaName: string; outputLanguage: "zh" | "en"; automaticSplit: boolean; payer?: "platform" | "byok"; modelId?: string }; onClose: () => void; onComplete: (bundle: unknown) => void }) {
  const zh = useLocale() === "zh";
  const automaticSplit = source.automaticSplit;
  const payer = source.payer ?? "platform";
  const model = "flash";
  const byokModel = source.modelId || "analysis-gemini-3-8-flash";
  const selectedModelId = payer === "byok" ? byokModel : "analysis-gemini-3-8-flash";
  const modelName = listModels("analysis").find(item => item.id === selectedModelId)?.displayName || selectedModelId;
  const [preparation, setPreparation] = useState<{ id: string; scenes: SceneInterval[]; durationUs: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quote, setQuote] = useState<{ id: string; credits: number; splitCredits: number; analysisCredits: number } | null>(null);
  const [taskId, setTaskId] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const completed = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const playingPreview = useRef<HTMLVideoElement | null>(null);
  const selectedScenes = preparation?.scenes.filter(scene => selected.includes(scene.id)) || [];
  const allSelected = Boolean(preparation && selectedScenes.length === preparation.scenes.length);
  const selectionLocked = busy || Boolean(quote);
  const selectedSeconds = selectedScenes.reduce((total, scene) => total + scene.endUs - scene.startUs, 0) / 1000000;
  const estimatedCredits = preparation && selectedScenes.length ? quoteAnalysis({
    payer: payer === "platform" ? "platform" : automaticSplit ? "byok_split" : "byok",
    model: model as "flash" | "pro", sourceDurationUs: preparation.durationUs,
    scenes: selectedScenes, automaticSplit, paidSplitReusable: false,
  }).credits : null;
  const onCompleteRef = useRef(onComplete); onCompleteRef.current = onComplete;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedScenes.length > 0 && !allSelected;
  }, [selectedScenes.length, allSelected]);
  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok && data.code === "UPLOAD_VIDEO_TOO_LONG") throw new Error(zh ? "上传文件只支持 10 秒以内的完整单镜头片段。" : "File uploads support one complete shot up to 10 seconds.");
    if (!response.ok) throw new Error(data.code === "INSUFFICIENT_COMMERCIAL_BALANCE" ? (zh ? "可用积分不足，请先充值。" : "Not enough available credits. Please top up.") : data.code === "KIE_KEY_REQUIRED" ? (zh ? "请先配置所选来源的 KIE Key。" : "Configure the KIE key for this payment source first.") : (zh ? "暂时无法确认，请重试。任务结果不明确时，请勿重复提交。" : "Unable to confirm. Retry to check; do not resubmit an uncertain task."));
    return data;
  }
  async function next() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (!preparation) {
        const data = await post("/api/commercial/analysis", { action: "prepare", ...source, automaticSplit });
        setPreparation(data); setSelected(data.scenes.map((s: SceneInterval) => s.id));
      } else if (!quote) {
        setQuote(await post("/api/commercial/analysis", { action: "quote", preparationId: preparation.id, sceneIds: selected, payer: payer === "platform" ? "platform" : automaticSplit ? "byok_split" : "byok", model, modelId: payer === "byok" ? byokModel : undefined, outputLanguage: source.outputLanguage }));
      } else {
        // Keep the same server quote ID even when the confirmation response is lost.
        const data = await post(`/api/commercial/tasks/${quote.id}`, {});
        setTaskId(data.id); setState(data.state);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!taskId || completed.current || state === "review") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/commercial/tasks/${taskId}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (controller.signal.aborted) return;
        setState(data.state);
        if (["completed", "failed"].includes(data.state) && data.bundle && !completed.current) { completed.current = true; onCompleteRef.current(data.bundle); }
        if (["completed", "failed", "review"].includes(data.state)) return;
      } catch { if (!controller.signal.aborted) setError(zh ? "查询暂时中断，任务仍保留在账户中。" : "Status temporarily unavailable. Your task remains in your account."); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [taskId, state, zh]);
  return <section aria-labelledby="analysis-quote-title" className="min-h-0 flex-1 overflow-y-auto p-1 text-foreground">
    <header className="flex items-start justify-between gap-4"><h2 id="analysis-quote-title" className="text-xl font-semibold">{zh ? "镜头选择与费用" : "Shots and analysis cost"}</h2>{!taskId && <button disabled={busy} onClick={onClose} title={zh ? "返回素材选择" : "Back to reference"} aria-label={zh ? "返回素材选择" : "Back to reference"} className="flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-50"><X size={18} /></button>}</header>
    <p className="mt-3 truncate text-sm text-muted-foreground">{source.mediaName}</p>
    {!taskId && <>
      <p className="mt-3 text-sm text-muted-foreground">{modelName} · {payer === "platform" ? (zh ? "平台积分" : "Platform credits") : (zh ? "自带 Key" : "Own key")}</p>
      <p className="mt-3 text-sm">{automaticSplit ? (zh ? "链接视频：先拆镜，再选择镜头分析。" : "Linked video: split first, then select shots to analyze.") : (zh ? "上传文件：单镜头分析，不收拆镜费。" : "Uploaded file: single-shot analysis, no splitting fee.")}</p>
      {preparation && <div className="mt-5">
        <p className="mb-3 text-sm">{(preparation.durationUs / 1000000).toFixed(2)}s · {preparation.scenes.length} {zh ? "个镜头" : "shots"}</p>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex min-h-11 items-center gap-2"><input ref={selectAll} type="checkbox" checked={allSelected} disabled={selectionLocked} onChange={e => setSelected(e.target.checked ? preparation.scenes.map(scene => scene.id) : [])} />{zh ? "全选" : "Select all"}</label>
          <span role="status" className="text-muted-foreground">{zh ? `已选 ${selectedScenes.length}/${preparation.scenes.length} 个镜头 · ${selectedSeconds.toFixed(2)} 秒` : `${selectedScenes.length}/${preparation.scenes.length} shots selected · ${selectedSeconds.toFixed(2)} sec`}</span>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-2">{preparation.scenes.map((scene, index) => <article key={scene.id} aria-label={zh ? `镜头 ${index + 1}` : `Shot ${index + 1}`} className="rounded-lg border border-border bg-background p-3 sm:p-4">
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-9 cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" aria-label={zh ? `镜头 ${index + 1}` : `Shot ${index + 1}`} checked={selected.includes(scene.id)} disabled={selectionLocked} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, scene.id] : ids.filter((id) => id !== scene.id))} />
                <h3 className="text-base font-semibold">{zh ? "镜头" : "Shot"} {String(index + 1).padStart(2, "0")}</h3>
              </label>
              <span className="text-xs text-muted-foreground">{zh ? "待分析" : "Not analyzed"}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{(scene.startUs / 1000000).toFixed(2)}–{(scene.endUs / 1000000).toFixed(2)}s · {((scene.endUs - scene.startUs) / 1000000).toFixed(2)}s</p>
          </div>
          <SceneVideoPreview mediaUrl={source.mediaUrl} startUs={scene.startUs} endUs={scene.endUs} label={zh ? `镜头 ${index + 1} 预览` : `Shot ${index + 1} preview`} zh={zh} onPlay={(video) => {
            if (playingPreview.current !== video) playingPreview.current?.pause();
            playingPreview.current = video;
          }} />
        </article>)}</div>
        {!selectedScenes.length && <p className="mt-2 text-sm text-muted-foreground">{zh ? "请至少选择一个镜头。" : "Select at least one shot."}</p>}
        {estimatedCredits !== null && !quote && <p className="mt-3 text-sm">{zh ? `预计 ${estimatedCredits} 积分` : `Estimated ${estimatedCredits} credits`}</p>}
      </div>}
      {quote && <div className="my-5 border-y border-border py-4"><p className="text-2xl font-semibold">{quote.credits} {zh ? "积分" : "credits"}</p><p className="mt-2 text-sm text-muted-foreground">{zh ? `拆镜 ${quote.splitCredits} + 分析 ${quote.analysisCredits}。确认后预留，按成功结果结算。` : `Splitting ${quote.splitCredits} + analysis ${quote.analysisCredits}. Reserved on confirmation, settled by successful results.`}</p>{payer === "byok" && <p className="mt-2 text-sm">{zh ? "模型费用由你的 KIE 账户承担。" : "Model fees are billed to your KIE account."}</p>}</div>}
      <div className="mt-5 flex gap-3">
        <button disabled={busy || Boolean(preparation && !selected.length)} onClick={() => void next()} className="min-h-11 min-w-0 rounded-lg bg-foreground px-3 py-1 text-sm font-semibold leading-tight text-background disabled:opacity-50">{busy ? (zh ? "处理中…" : "Working…") : !preparation ? (zh ? "读取视频信息" : "Inspect video") : !quote ? (zh ? "获取报价" : "Get quote") : (zh ? `确认并分析 · ${quote.credits} 积分` : `Confirm analysis · ${quote.credits} credits`)}</button>
      </div>
      {quote && <button disabled={busy} onClick={() => setQuote(null)} className="mt-3 min-h-10 px-3 text-sm underline">{zh ? "调整选择" : "Adjust selection"}</button>}
    </>}
    {taskId && <p role="status" className="mt-6">{state === "review" ? (zh ? "任务结果需要核对，额度保持预留，不会重复扣款。" : "This task needs review. Credits remain reserved and will not be charged twice.") : (zh ? "任务已保存，正在处理。" : "Task saved and processing.")}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </section>;
}
