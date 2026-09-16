"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { X } from "lucide-react";
type Quote = { id: string; credits: number; model: string; duration: number; resolution: string };
export function GenerationQuoteDialog({ request, quantity, onClose, onConfirmed }: { request: Record<string, unknown>; quantity: number; onClose: () => void; onConfirmed: (ids: string[]) => void }) {
  const zh = useLocale() === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function next() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (!quotes.length) {
        const rows: Quote[] = [];
        for (let i = 0; i < quantity; i++) {
          const response = await fetch("/api/commercial/generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
          if (!response.ok) throw new Error(zh ? "该付费组合尚未开放。当前支持 Wan 2.6，720p，5秒或10秒，最多一张参考图，不含参考视频。" : "This paid combination is unavailable. Supported: Wan 2.6, 720p, 5 or 10 seconds, up to one image and no reference video.");
          rows.push(await response.json());
        }
        setQuotes(rows);
      } else {
        const response = await fetch("/api/commercial/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: quotes.map((q) => q.id) }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.code === "INSUFFICIENT_COMMERCIAL_BALANCE" ? (zh ? "积分不足，本次未启动任何新任务。" : "Insufficient credits. No new tasks were started.") : (zh ? "确认状态暂不明确，请用当前报价重试，不要重新提交。" : "Confirmation is uncertain. Retry these quotes instead of submitting again."));
        onConfirmed(quotes.map((q) => q.id));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="generation-quote-title" className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground backdrop:bg-black/50">
    <header className="flex justify-between gap-3"><h2 id="generation-quote-title" className="text-xl font-semibold">{zh ? "确认生成费用" : "Confirm generation cost"}</h2><button onClick={onClose} aria-label={zh ? "关闭" : "Close"} className="flex h-8 w-8 items-center justify-center"><X size={18} /></button></header>
    <p className="mt-4 text-sm">{quantity} {zh ? "条视频" : "videos"}</p>
    {quotes.length > 0 && <><p className="mt-5 text-3xl font-semibold">{quotes.reduce((sum, q) => sum + q.credits, 0)} {zh ? "积分" : "credits"}</p><p className="mt-3 text-sm text-muted-foreground">{quotes[0].model} · {quotes[0].resolution} · {quotes[0].duration}s</p><p className="mt-3 text-sm">{zh ? "确认后预留总额度，每条视频独立结算，失败的部分退回。" : "The total is reserved on confirmation. Each video settles separately; failed outputs release their credits."}</p></>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <button disabled={busy} onClick={() => void next()} className="mt-6 min-h-11 w-full rounded-lg bg-foreground px-4 text-background disabled:opacity-50">{busy ? (zh ? "处理中…" : "Working…") : quotes.length ? (zh ? "确认并生成" : "Confirm and generate") : (zh ? "获取报价" : "Get quote")}</button>
  </dialog>;
}
