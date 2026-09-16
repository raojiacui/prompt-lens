"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, RefreshCw } from "lucide-react";
type Task = { id: string; kind: string; state: string; credits: number; chargedCredits?: number; videoUrl?: string; nextTaskId?: string; retryAvailable?: boolean; bundle?: { sceneVersions: { id: string; sceneIndex: number; duration: number; generationPrompt: string }[] } };
export default function BillingTaskPage() {
  const { id } = useParams<{ id: string }>();
  const zh = useLocale() === "zh";
  const [task, setTask] = useState<Task | null>(null);
  const [quote, setQuote] = useState<{ id: string; credits: number; sceneCount: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/commercial/tasks/${id}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.href = `/login?next=${encodeURIComponent(`/billing/tasks/${id}`)}`; return; }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) { setTask(data); setError(""); }
        if (["queued", "running"].includes(data.state) && !controller.signal.aborted) timer = setTimeout(load, 5000);
      } catch { if (!controller.signal.aborted) setError(zh ? "暂时无法查询，请稍后刷新。" : "Status unavailable. Refresh later."); }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, zh, refresh]);
  async function retry() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(quote ? `/api/commercial/tasks/${quote.id}` : "/api/commercial/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quote ? {} : { action: "retry", taskId: id }) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (quote) window.location.href = `/billing/tasks/${quote.id}`;
      else setQuote(data);
    } catch { setError(zh ? "暂时无法确认重试，请保留当前报价并稍后查询。" : "Retry is unconfirmed. Keep this quote and check again later."); }
    finally { setBusy(false); }
  }
  const state = task?.state;
  return <main className="mx-auto max-w-4xl px-4 py-8">
    <header className="flex items-center justify-between border-b border-border pb-5"><Link href="/billing" className="flex items-center gap-2"><ArrowLeft size={18} />{zh ? "余额与订单" : "Balance and orders"}</Link><button aria-label={zh ? "刷新" : "Refresh"} title={zh ? "刷新" : "Refresh"} onClick={() => setRefresh((n) => n + 1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><RefreshCw size={18} /></button></header>
    <h1 className="mt-8 text-2xl font-semibold">{zh ? "创作任务" : "Creation task"}</h1><p className="mt-2 break-all text-xs text-muted-foreground">{id}</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {task && <>
      <p role="status" className="mt-6">{zh ? ({ quoted: "等待确认", queued: "排队中", running: "处理中", completed: "已完成", failed: "未完成", review: "结果待核对，额度仍在预留中" }[state || ""] || "待确认") : state}</p>
      <p className="mt-2 text-sm">{task.chargedCredits === undefined ? (zh ? "预留" : "Reserved") : (zh ? "已结算" : "Settled")}: {task.chargedCredits ?? task.credits} {zh ? "积分" : "credits"}</p>
      {task.videoUrl && <video className="mt-6 w-full rounded-lg" controls playsInline src={task.videoUrl} />}
      {task.nextTaskId && <Link href={`/billing/tasks/${task.nextTaskId}`} className="mt-5 inline-block underline">{zh ? "查看后续重试" : "View subsequent retry"}</Link>}
      {task.retryAvailable && <div className="my-6 border-y border-border py-5">{quote && <p className="mb-3">{quote.sceneCount} {zh ? "个失败镜头，本次最多" : "failed shots, up to"} {quote.credits} {zh ? "积分" : "credits"}</p>}<button disabled={busy} onClick={() => void retry()} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">{quote ? (zh ? "确认费用并重试" : "Confirm cost and retry") : (zh ? "获取失败镜头重试报价" : "Quote failed-shot retry")}</button></div>}
      {task.bundle?.sceneVersions.map((s) => <section key={s.id} className="border-b border-border py-6"><h2 className="text-lg font-semibold">{zh ? "镜头" : "Shot"} {s.sceneIndex} · {s.duration}s</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{s.generationPrompt}</p></section>)}
    </>}
  </main>;
}
