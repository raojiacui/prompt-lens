"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, RefreshCw } from "lucide-react";

type Review = { orders: { id: string; userId: string; amountCents: number; reconciliation: string | null }[]; refunds: { id: string; orderId: string; state: string }[]; tasks: { id: string; userId: string; credits: number; rewrites: number }[]; frozen: { userId: string }[] };
export default function CommercialReviewPage() {
  const zh = useLocale() === "zh";
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [evidence, setEvidence] = useState("");
  async function act(body: Record<string, string>) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/payments/commercial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(zh ? "处理未完成，请刷新并核对记录后重试。" : "Action not completed. Refresh and verify the records before retrying.");
      setSelectedTask(""); setEvidence(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  async function load() {
    try {
      const response = await fetch("/api/admin/payments/commercial", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? (zh ? "仅管理员可查看。" : "Administrator access required.") : (zh ? "暂时无法读取对账记录。" : "Unable to load reconciliation records."));
      setData(await response.json()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }
  useEffect(() => { void load(); }, [zh]);
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <header className="flex items-center justify-between border-b border-border pb-5"><Link href="/dashboard?tab=admin" className="flex items-center gap-2"><ArrowLeft size={18} />{zh ? "后台" : "Admin"}</Link><button onClick={() => void load()} title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新" : "Refresh"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><RefreshCw size={18} /></button></header>
    <h1 className="mt-8 text-2xl font-semibold">{zh ? "资金对账" : "Payment reconciliation"}</h1>
    {error && <p role="alert" className="mt-5 text-red-700">{error}</p>}
    {data && <>
      <h2 className="mt-8 text-lg font-semibold">{zh ? "待确认订单" : "Unconfirmed orders"} ({data.orders.length})</h2>
      {data.orders.map((o) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 text-sm"><span className="break-all">{o.id}</span><span>¥{(o.amountCents / 100).toFixed(2)} · {zh ? "待核对" : (o.reconciliation || "Pending")}</span><button disabled={busy} onClick={() => void act({ action: "query", orderId: o.id })} className="min-h-10 px-3 underline disabled:opacity-50">{zh ? "查询支付状态" : "Query payment"}</button></div>)}
      <h2 className="mt-8 text-lg font-semibold">{zh ? "退款待复核" : "Refund review"} ({data.refunds.length})</h2>
      {data.refunds.map((r) => <p key={r.id} className="break-all border-b border-border py-4 text-sm">{r.orderId} · {zh ? "请核对商户退款记录" : r.state}</p>)}
      <h2 className="mt-8 text-lg font-semibold">{zh ? "超过24小时的任务预留" : "Reservations older than 24 hours"} ({data.tasks.length})</h2>
      {data.tasks.map((t) => <div key={t.id} className="border-b border-border py-4 text-sm"><p className="break-all">{t.id} · {t.credits} {zh ? "积分" : "credits"} · {t.rewrites} {zh ? "次改写" : "rewrites"}</p><button disabled={busy} onClick={() => { setSelectedTask(t.id); setEvidence(""); }} className="mt-2 min-h-10 underline">{zh ? "核对未交付任务" : "Review undelivered task"}</button>
        {selectedTask === t.id && <form onSubmit={(event) => { event.preventDefault(); void act({ action: "release_unfulfilled_task", reservationId: t.id, evidence }); }} className="mt-3 space-y-3">
          <p className="text-red-700">{zh ? "仅在确认服务未交付、无需扣费后释放预留。结果未知不能按失败处理。此操作会记录管理员与核对依据。" : "Release only after verifying no service was delivered and no charge is due. Unknown is not failed. Your identity and evidence will be recorded."}</p>
          <label className="block">{zh ? "供应商记录与核对依据" : "Provider records and review evidence"}<textarea required minLength={12} maxLength={2000} value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-border bg-background p-3" /></label>
          <button disabled={busy || evidence.trim().length < 12} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">{zh ? "确认未交付并释放预留" : "Confirm non-delivery and release"}</button>
        </form>}
      </div>)}
      <h2 className="mt-8 text-lg font-semibold">{zh ? "冻结账户" : "Frozen accounts"} ({data.frozen.length})</h2>
      {data.frozen.map((w) => <p key={w.userId} className="break-all border-b border-border py-4 text-sm">{w.userId}</p>)}
    </>}
  </main>;
}
