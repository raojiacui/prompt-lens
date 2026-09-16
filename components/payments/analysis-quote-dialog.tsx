"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { X } from "lucide-react";
import type { SceneInterval } from "@/lib/billing/pricing-v6";

export function AnalysisQuoteDialog({ source, onClose, onComplete }: { source: { projectId: string; mediaUrl: string; mediaName: string; outputLanguage: "zh" | "en" }; onClose: () => void; onComplete: (bundle: unknown) => void }) {
  const zh = useLocale() === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const [automaticSplit, setAutomaticSplit] = useState(true);
  const [payer, setPayer] = useState("platform");
  const [model, setModel] = useState("flash");
  const [preparation, setPreparation] = useState<{ id: string; scenes: SceneInterval[]; durationUs: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quote, setQuote] = useState<{ id: string; credits: number; splitCredits: number; analysisCredits: number } | null>(null);
  const [taskId, setTaskId] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete); onCompleteRef.current = onComplete;
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
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
        setQuote(await post("/api/commercial/analysis", { action: "quote", preparationId: preparation.id, sceneIds: selected, payer: payer === "platform" ? "platform" : automaticSplit ? "byok_split" : "byok", model, outputLanguage: source.outputLanguage }));
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
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="analysis-quote-title" className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground backdrop:bg-black/50">
    <header className="flex justify-between gap-4"><h2 id="analysis-quote-title" className="text-xl font-semibold">{zh ? "确认分析费用" : "Confirm analysis cost"}</h2><button onClick={onClose} aria-label={zh ? "关闭" : "Close"} className="flex h-8 w-8 items-center justify-center"><X size={18} /></button></header>
    <p className="mt-3 truncate text-sm text-muted-foreground">{source.mediaName}</p>
    {!taskId && <>
      <fieldset disabled={busy || Boolean(quote)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">{zh ? "费用来源" : "Payment source"}<select value={payer} onChange={(e) => setPayer(e.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-border bg-background px-2"><option value="platform">{zh ? "平台积分" : "Platform credits"}</option><option value="byok">{zh ? "自己的 KIE Key" : "My KIE key"}</option></select></label>
        <label className="text-sm">{zh ? "分析模型" : "Analysis model"}<select value={model} onChange={(e) => setModel(e.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-border bg-background px-2"><option value="flash">Gemini 2.5 Flash</option><option value="pro">Gemini 2.5 Pro</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={automaticSplit} disabled={Boolean(preparation)} onChange={(e) => setAutomaticSplit(e.target.checked)} />{zh ? "自动拆镜" : "Automatic shot splitting"}</label>
      </fieldset>
      {preparation && <div className="mt-5"><p className="mb-3 text-sm">{(preparation.durationUs / 1000000).toFixed(2)}s · {preparation.scenes.length} {zh ? "个镜头" : "shots"}</p><div className="max-h-52 overflow-auto border-y border-border">{preparation.scenes.map((scene) => <label key={scene.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2 text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(scene.id)} disabled={Boolean(quote) || !automaticSplit} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, scene.id] : ids.filter((id) => id !== scene.id))} />{zh ? "镜头" : "Shot"} {scene.id}</span><span>{(scene.startUs / 1000000).toFixed(2)}–{(scene.endUs / 1000000).toFixed(2)}s · {((scene.endUs - scene.startUs) / 1000000).toFixed(2)}s</span></label>)}</div></div>}
      {quote && <div className="my-5 border-y border-border py-4"><p className="text-2xl font-semibold">{quote.credits} {zh ? "积分" : "credits"}</p><p className="mt-2 text-sm text-muted-foreground">{zh ? `拆镜 ${quote.splitCredits} + 分析 ${quote.analysisCredits}。确认后预留，按成功结果结算。` : `Splitting ${quote.splitCredits} + analysis ${quote.analysisCredits}. Reserved on confirmation, settled by successful results.`}</p>{payer === "byok" && <p className="mt-2 text-sm">{zh ? "模型费用由你的 KIE 账户承担。" : "Model fees are billed to your KIE account."}</p>}</div>}
      <div className="mt-5 flex gap-3"><button disabled={busy || Boolean(preparation && !selected.length)} onClick={() => void next()} className="min-h-11 rounded-lg bg-foreground px-4 text-background disabled:opacity-50">{busy ? (zh ? "处理中…" : "Working…") : !preparation ? (zh ? "读取视频信息" : "Inspect video") : !quote ? (zh ? "获取报价" : "Get quote") : (zh ? "确认并开始" : "Confirm and start")}</button>{quote && <button disabled={busy} onClick={() => setQuote(null)} className="px-3 text-sm">{zh ? "调整选择" : "Adjust selection"}</button>}</div>
    </>}
    {taskId && <p role="status" className="mt-6">{state === "review" ? (zh ? "任务结果需要核对，额度保持预留，不会重复扣款。" : "This task needs review. Credits remain reserved and will not be charged twice.") : (zh ? "任务已保存，正在处理。" : "Task saved and processing.")}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <Link href="/billing" className="mt-5 inline-block text-sm underline">{zh ? "余额与任务记录" : "Balance and task history"}</Link>
  </dialog>;
}
