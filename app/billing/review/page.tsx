"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, RefreshCw } from "lucide-react";

type Review = { orders: { id: string; userId: string; amountCents: number; reconciliation: string | null }[]; refunds: { id: string; orderId: string; userId: string; email?: string | null; name?: string | null; packageName?: string; createdAt?: string; state: string; reason: string; contact: string | null; amountCents: number }[]; tasks: { id: string; userId: string; credits: number; rewrites: number }[]; frozen: { userId: string }[] };
export default function CommercialReviewPage() {
  const zh = useLocale() === "zh";
  const [data, setData] = useState<Review | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRefund, setSelectedRefund] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [customerContacted, setCustomerContacted] = useState(false);
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const refundHeading = useRef<HTMLHeadingElement>(null);
  const locatedRefunds = useRef(false);
  useEffect(() => {
    if (data && !locatedRefunds.current && window.location.hash === "#refunds") {
      refundHeading.current?.scrollIntoView({ block: "start" });
      locatedRefunds.current = true;
    }
  }, [data]);
  async function act(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/payments/commercial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(zh ? "处理未完成，请刷新并核对记录后重试。" : "Action not completed. Refresh and verify the records before retrying.");
      if (body.action === "query_refund" || body.action === "approve_refund") {
        const result = await response.json();
        setNotice(result.state === "succeeded"
          ? (zh ? "支付宝已确认退款成功，订单已更新。" : "Alipay confirmed the refund. The order has been updated.")
          : (zh ? "尚未确认退款成功，保留待核对状态，未再次发起退款。" : "Refund remains unconfirmed. No refund was resubmitted."));
      }
      if (body.action === "reject_refund") setNotice(zh ? "已拒绝申请，套餐额度已恢复。" : "Request declined. Package balance restored.");
      window.dispatchEvent(new Event("refund-requests-changed"));
      setSelectedRefund(""); setReviewNote(""); setCustomerContacted(false); setApproveConfirmed(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  async function load() {
    try {
      const response = await fetch(`/api/admin/payments/commercial?view=refunds&page=${page}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(response.status === 403 ? (zh ? "仅管理员可查看。" : "Administrator access required.") : (zh ? "暂时无法读取对账记录。" : "Unable to load reconciliation records."));
      const result = await response.json(); setData(result); setTotal(result.total); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }
  useEffect(() => { setData(null); void load(); }, [zh, page]);
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <header className="flex items-center justify-between border-b border-border pb-5"><Link href="/dashboard?tab=admin" className="flex items-center gap-2"><ArrowLeft size={18} />{zh ? "后台" : "Admin"}</Link><button onClick={() => void load()} title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新" : "Refresh"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><RefreshCw size={18} /></button></header>
    <h1 className="mt-8 text-2xl font-semibold">{zh ? "退款申请" : "Refund requests"}</h1>
    {error && <p role="alert" className="mt-5 text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-5 text-sm">{notice}</p>}
    {data && <>
      <h2 ref={refundHeading} id="refunds" className="mt-8 scroll-mt-6 text-lg font-semibold">{zh ? "待处理" : "Awaiting review"} ({total})</h2>
      {!data.refunds.length && <p className="mt-3 text-sm text-muted-foreground">{zh ? "暂无待处理的退款申请" : "No refund requests awaiting review"}</p>}
      {data.refunds.map((r) => <div key={r.id} className="space-y-3 border-b border-border py-4 text-sm">
        <p className="break-all font-medium">{r.name || r.email || r.userId}{r.name && r.email ? ` · ${r.email}` : ""}</p>
        <p>{r.packageName || "--"} · {({ requested: zh ? "待审核" : "Awaiting approval", processing: zh ? "退款处理中" : "Processing refund", review: zh ? "结果待核对" : "Outcome unconfirmed" }[r.state]) || r.state}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}` : ""}</p>
        <p className="break-all">{r.orderId} · ¥{(r.amountCents / 100).toFixed(2)}</p>
        <p className="break-words">{zh ? "申请原因：" : "Reason: "}{r.reason}</p>
        <p className="break-all">{zh ? "联系方式：" : "Contact: "}{r.contact || (zh ? "未提供，请核对用户资料" : "Not provided; check customer records")}</p>
        {r.state === "requested" ? <>
          <button disabled={busy} onClick={() => { setSelectedRefund(r.id); setReviewNote(""); setCustomerContacted(false); setApproveConfirmed(false); }} className="min-h-10 underline">{zh ? "审核申请" : "Review request"}</button>
          {selectedRefund === r.id && <div className="space-y-3" role="group" aria-label={zh ? "退款审核" : "Refund approval"}>
            <label className="flex items-start gap-2"><input type="checkbox" checked={customerContacted} onChange={(event) => setCustomerContacted(event.target.checked)} className="mt-1" />{zh ? "已与用户沟通并核对订单" : "I have contacted the customer and verified the order"}</label>
            <label className="block">{zh ? "处理备注（必填）" : "Review note (required)"}<textarea required minLength={1} maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-border bg-background p-3" /></label>
            <label className="flex items-start gap-2"><input type="checkbox" checked={approveConfirmed} onChange={(event) => setApproveConfirmed(event.target.checked)} className="mt-1" />{zh ? `我同意退还此订单全额 ¥${(r.amountCents / 100).toFixed(2)}；点击同意将向支付宝发起真实退款` : `I approve a full refund of ¥${(r.amountCents / 100).toFixed(2)}; approving will send a real Alipay refund`}</label>
            {(!reviewNote.trim() || !customerContacted) && <p className="text-muted-foreground">{zh ? "请填写处理备注，并确认已与用户沟通。" : "Enter a review note and confirm customer contact."}</p>}
            <div className="flex flex-wrap gap-3">
              <button disabled={busy || !customerContacted || !approveConfirmed || !reviewNote.trim()} onClick={() => void act({ action: "approve_refund", refundId: r.id, evidence: reviewNote, customerContacted, approveConfirmed })} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">{busy ? (zh ? "处理中…" : "Processing…") : (zh ? "同意并执行退款" : "Approve and refund")}</button>
              <button disabled={busy || !customerContacted || !reviewNote.trim()} onClick={() => void act({ action: "reject_refund", refundId: r.id, evidence: reviewNote, customerContacted })} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">{zh ? "拒绝申请并恢复额度" : "Decline and restore allowance"}</button>
            </div>
          </div>}
        </> : <>
          <p className="text-red-700">{zh ? "退款处理中或结果待核对。请先核对支付宝商户记录，不要重复发起退款。" : "Refund processing or outcome uncertain. Verify Alipay merchant records; do not submit another refund."}</p>
          <button disabled={busy} onClick={() => void act({ action: "query_refund", refundId: r.id })} className="flex min-h-10 items-center gap-2 underline disabled:opacity-50"><RefreshCw size={16} />{zh ? "查询退款状态" : "Query refund status"}</button>
        </>}
      </div>)}
      <div className="mt-5 flex justify-end gap-4"><button disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>{zh ? "上一页" : "Previous"}</button><span>{page} / {Math.max(1, Math.ceil(total / 20))}</span><button disabled={busy || page * 20 >= total} onClick={() => setPage(p => p + 1)}>{zh ? "下一页" : "Next"}</button></div>
    </>}
  </main>;
}
