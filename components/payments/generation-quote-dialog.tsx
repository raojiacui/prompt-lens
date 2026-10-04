"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { X } from "lucide-react";
type Quote = { id: string; credits: number; model: string; duration: number; resolution: string; referenceVideoSeconds?: number };
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
          const body = await response.json();
          if (!response.ok) {
            const messages: Record<string, [string, string]> = {
              MODEL_PRICE_UNVERIFIED: ["该型号的官方价格或接口仍待核实，暂不能用平台积分提交。请换一个已核价模型。", "This model's price or API is not verified yet. Choose a priced model."],
              PAID_MODEL_NOT_VERIFIED: ["请选择有效的视频生成或编辑模型。", "Choose an available video generation or editing model."],
              PAID_GENERATION_CONFIGURATION_UNSUPPORTED: ["当前模型不支持这组素材、时长或画质，请调整参数后重新报价。", "This model does not support these inputs, duration or quality. Adjust the settings and quote again."],
              PAID_GENERATION_ASPECT_UNSUPPORTED: ["当前模型不支持所选比例，请选择自动或模型支持的比例。", "Choose Auto or an aspect ratio supported by this model."],
              UPLOAD_NOT_OWNED: ["请使用当前账户上传的参考视频。", "Use a reference video uploaded by your account."],
              INSUFFICIENT_COMMERCIAL_BALANCE: ["积分不足或账户暂不可使用，未启动生成。", "Insufficient credits or an unavailable wallet. No generation started."],
              PREVIEW_RATE_LIMIT: ["参考视频报价过于频繁，请稍后再试。", "Too many reference-video quotes. Try again later."],
              MEDIA_PROBE_NOT_CONFIGURED: ["参考视频时长检测暂不可用，请联系客服。", "Reference-video probing is unavailable. Contact support."],
            };
            throw new Error(messages[body.code]?.[zh ? 0 : 1] || (zh ? "暂时无法获取报价，请稍后重试。未扣积分。" : "Unable to quote right now. Try again later. No credits charged."));
          }
          rows.push(body);
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
    {quotes.length > 0 && <><p className="mt-5 text-3xl font-semibold">{quotes.reduce((sum, q) => sum + q.credits, 0)} {zh ? "积分" : "credits"}</p><p className="mt-3 text-sm text-muted-foreground">{quotes[0].model} · {quotes[0].resolution} · {quotes[0].duration}s</p><ul className="mt-3 space-y-1 text-sm">{quotes.map((q, i) => <li key={q.id} className="flex justify-between gap-3"><span>{zh ? `视频 ${i + 1}` : `Video ${i + 1}`}</span><span>{q.credits} {zh ? "积分" : "credits"}</span></li>)}</ul><p className="mt-3 text-sm">{zh ? "确认后预留总额度，每条视频独立结算，失败的部分退回。" : "The total is reserved on confirmation. Each video settles separately; failed outputs release their credits."}</p></>}
    {quotes[0]?.referenceVideoSeconds !== undefined && <p className="mt-3 text-sm text-muted-foreground">{zh ? "参考视频计费时长（服务端检测）" : "Reference-video billing duration (server verified)"}: {quotes[0].referenceVideoSeconds}s</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <button disabled={busy} onClick={() => void next()} className="mt-6 min-h-11 w-full rounded-lg bg-foreground px-4 text-background disabled:opacity-50">{busy ? (zh ? "处理中…" : "Working…") : quotes.length ? (zh ? "确认并生成" : "Confirm and generate") : (zh ? "获取报价" : "Get quote")}</button>
  </dialog>;
}
