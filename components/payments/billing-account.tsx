"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { AlipayCheckoutDialog } from "@/components/payments/alipay-checkout-dialog";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";
import { SUPPORT_WECHAT } from "@/lib/support-contact";

type Order = { id: string; packageId: string; packageName: string; amountCents: number; status: string; createdAt: string };
type Account = {
  wallet: { credits: number; rewrites: number; heldCredits: number; heldRewrites: number; frozen: boolean };
  orders: Order[];
  refunds: { id: string; orderId: string; state: string }[];
  tasks: { id: string; taskKey: string; state: string; credits: number; rewrites: number; settledCredits: number | null; settledRewrites: number | null; createdAt: string }[];
};

export function BillingAccount({ embedded = false }: { embedded?: boolean }) {
  const Container = embedded ? "section" : "main";
  const zh = useLocale() === "zh";
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundContact, setRefundContact] = useState("");
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/payments/account", { cache: "no-store" });
      if (response.status === 401) { window.location.href = "/login?next=%2Fbilling"; return; }
      if (!response.ok) throw new Error();
      setAccount(await response.json()); setError("");
    } catch { setError(zh ? "暂时无法读取账户，请稍后重试。" : "Unable to load your account. Try again later."); }
  }, [zh]);
  useEffect(() => { void load(); }, [load]);
  const status = (value: string) => zh ? ({ pending: "待确认", paid: "已到账", refunded: "已退款", cancelled: "已取消", failed: "失败", requested: "等待客服审核", processing: "退款处理中", succeeded: "退款成功", rejected: "退款申请未通过", review: "人工复核中", held: "任务处理中", settled: "已结算" }[value] || value) : ({ requested: "Awaiting support review", rejected: "Refund request declined" }[value] || value);
  const pack = COMMERCIAL_PACKAGES.find((p) => p.id === selected?.packageId);
  async function cancelPayment() {
    if (!cancelOrder || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/payments/orders/${cancelOrder.id}/close`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || data.status === "pending") throw new Error(zh ? "取消结果待核对，请保留订单号，暂勿继续付款。" : "Cancellation is unconfirmed. Keep the order ID and do not continue payment.");
      setCancelOrder(null); await load();
      setNotice(data.status === "paid" ? (zh ? "此订单已付款，已核对到账，没有取消或退款。" : "This order was paid and has been credited, not cancelled or refunded.") : (zh ? "订单已结束，不会再要求支付这笔订单。" : "This order has ended and no longer requires payment."));
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  async function refund() {
    if (!refundOrder || busy || !refundReason.trim() || refundContact.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/payments/orders/${refundOrder.id}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: refundReason.trim(), contact: refundContact.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code === "PACKAGE_USED_OR_RESERVED" ? (zh ? "此套餐已有消耗或任务占用，不能整单退款，需要人工核对。" : "This package has usage or pending tasks. A full refund requires review.") : (zh ? "退款暂时无法确认，请保留订单号，不要重复申请。" : "Refund unconfirmed. Keep your order ID and do not submit again."));
      setRefundOrder(null); await load();
      setNotice(zh ? `退款申请已提交，请联系微信客服 ${SUPPORT_WECHAT}，审核同意后办理退款。` : `Refund request submitted. Contact WeChat support at ${SUPPORT_WECHAT}; approval is required before a refund is issued.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  return <Container className={embedded ? "mx-auto w-full max-w-5xl text-foreground" : "mx-auto min-h-screen max-w-5xl px-4 py-8 text-foreground md:px-8"}>
    <header className="flex items-center justify-between gap-4 border-b border-border pb-5">
      {embedded ? <h1 className="text-2xl font-semibold">{zh ? "账户" : "Account"}</h1> : <Link href="/dashboard" className="flex items-center gap-2 text-sm"><ArrowLeft size={18} />{zh ? "工作台" : "Workspace"}</Link>}
      <button onClick={() => void load()} title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新" : "Refresh"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><RefreshCw size={18} /></button>
    </header>
    {!embedded && <h1 className="mt-8 text-2xl font-semibold">{zh ? "余额与订单" : "Balance and orders"}</h1>}
    {error && !cancelOrder && !refundOrder && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm text-green-700">{notice}</p>}
    {!account && !error && <p className="mt-6" role="status">{zh ? "加载中…" : "Loading…"}</p>}
    {account && <>
      {account.wallet.frozen && <p className="mt-5 text-red-700">{zh ? "账户正在进行资金复核，暂不可启动付费任务。" : "Your wallet is under review. Paid tasks are temporarily unavailable."}</p>}
      <dl className="my-8 grid grid-cols-2 gap-6 border-b border-border pb-8 sm:grid-cols-4">
        {[ [zh ? "可用积分" : "Available credits", account.wallet.credits], [zh ? "可用改写" : "Rewrites", account.wallet.rewrites], [zh ? "任务预留积分" : "Reserved credits", account.wallet.heldCredits], [zh ? "任务预留改写" : "Reserved rewrites", account.wallet.heldRewrites] ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 text-2xl font-semibold">{value}</dd></div>)}
      </dl>
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{zh ? "购买记录" : "Purchases"}</h2><Link href="/#pricing" className="text-sm underline">{zh ? "购买积分" : "Buy credits"}</Link></div>
      {!account.orders.length && <p className="py-6 text-sm text-muted-foreground">{zh ? "暂无购买记录" : "No purchases yet"}</p>}
      {account.orders.map((order) => {
        const refundInfo = account.refunds.find((r) => r.orderId === order.id);
        return <div key={order.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
          <div className="min-w-0"><p className="font-medium">{order.packageName} · ¥{(order.amountCents / 100).toFixed(2)}</p><p className="mt-1 text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</p><p className="mt-1 break-all text-xs text-muted-foreground">{order.id}</p></div>
          <div className="flex flex-wrap items-center gap-3 text-sm"><span>{status(refundInfo?.state || order.status)}</span>
            {order.status === "pending" && <button className="min-h-10 rounded-lg border border-border px-3" onClick={() => setSelected(order)}>{zh ? "查看订单" : "View order"}</button>}
            {order.status === "pending" && <button disabled={busy} className="min-h-10 rounded-lg border border-border px-3" onClick={() => { setCancelOrder(order); setError(""); setNotice(""); }}>{zh ? "取消本次付款" : "Cancel this payment"}</button>}
            {order.status === "paid" && !refundInfo && <button disabled={busy} className="min-h-10 rounded-lg border border-border px-3" onClick={() => { setRefundOrder(order); setRefundReason(""); setRefundContact(""); setError(""); setNotice(""); }}>{zh ? "申请退款" : "Request refund"}</button>}
          </div>
        </div>;
      })}
      {cancelOrder && <AccountActionDialog title={zh ? "取消付款确认" : "Confirm payment cancellation"} busy={busy} onClose={() => { setCancelOrder(null); setError(""); }}>
        <div className="space-y-4 text-sm">
        <p className="font-medium">{cancelOrder.packageName} · ¥{(cancelOrder.amountCents / 100).toFixed(2)}</p>
        <p className="break-all">{cancelOrder.id}</p><p>{zh ? "确认取消这笔未支付订单？如已付款，会先核对到账，不会退款。" : "Cancel this unpaid order? Completed payments will be reconciled, not refunded."}</p>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex gap-3"><button disabled={busy} onClick={() => void cancelPayment()} className="min-h-10 rounded-lg border border-border px-4 disabled:opacity-50">{busy ? (zh ? "正在核对订单…" : "Checking order…") : (zh ? "确认取消" : "Confirm cancellation")}</button><button disabled={busy} onClick={() => { setCancelOrder(null); setError(""); }} className="min-h-10 px-4">{zh ? "返回" : "Back"}</button></div>
        </div>
      </AccountActionDialog>}
      {refundOrder && <AccountActionDialog title={zh ? "提交退款申请" : "Submit a refund request"} busy={busy} onClose={() => { setRefundOrder(null); setError(""); }}>
        <form aria-label={zh ? "退款申请表单" : "Refund request form"} onSubmit={(event) => { event.preventDefault(); void refund(); }} className="space-y-4">
        <p className="font-medium">{refundOrder.packageName} · ¥{(refundOrder.amountCents / 100).toFixed(2)}</p>
        <p className="text-sm text-muted-foreground">{zh ? `请填写表单后添加客服微信 ${SUPPORT_WECHAT}，提供订单号并沟通退款原因。提交申请不会自动退款；客服审核同意后才办理。审核期间该套餐权益暂停使用，未通过则恢复。已有消耗或处理中任务的订单请直接联系客服核对。` : `Complete the form, then add support on WeChat at ${SUPPORT_WECHAT} with your order ID and reason. Submitting does not issue a refund: support approval is required. Package benefits are paused during review and restored if declined. Contact support directly for used packages or pending tasks.`}</p>
        <p className="break-all text-sm">{zh ? "订单号：" : "Order ID: "}{refundOrder.id}</p>
        <label className="block text-sm">{zh ? "退款原因" : "Refund reason"}<textarea required maxLength={80} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-border bg-background p-3" /></label>
        <label className="block text-sm">{zh ? "联系邮箱或微信号" : "Contact email or WeChat ID"}<input required minLength={3} maxLength={100} value={refundContact} onChange={(event) => setRefundContact(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3" /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3"><button disabled={busy || !refundReason.trim() || refundContact.trim().length < 3} className="min-h-10 rounded-lg bg-foreground px-4 text-background disabled:opacity-50">{busy ? (zh ? "正在提交申请…" : "Submitting request…") : (zh ? "提交申请，等待客服审核" : "Submit for support review")}</button><button type="button" disabled={busy} onClick={() => { setRefundOrder(null); setError(""); }} className="px-4">{zh ? "取消" : "Cancel"}</button></div>
      </form></AccountActionDialog>}
      {account.refunds.some((refund) => refund.state === "requested") && <p className="my-5 text-sm">{zh ? `退款申请已提交，请添加客服微信 ${SUPPORT_WECHAT} 并提供订单号。审核通过前不会发起支付宝退款。` : `Request submitted. Contact WeChat support at ${SUPPORT_WECHAT} with your order ID. No Alipay refund is issued before approval.`}</p>}
      <h2 className="mt-10 text-lg font-semibold">{zh ? "任务消费" : "Task usage"}</h2>
      {!account.tasks.length && <p className="py-6 text-sm text-muted-foreground">{zh ? "暂无任务消费" : "No task usage yet"}</p>}
      {account.tasks.map((task) => <div key={task.id} className="flex flex-wrap justify-between gap-3 border-b border-border py-4 text-sm"><div><p>{task.taskKey.startsWith("commercial:") ? <Link className="underline" href={`/billing/tasks/${task.taskKey.slice(11)}`}>{zh ? "查看创作任务" : "View creation task"}</Link> : task.taskKey.startsWith("rewrite:") ? (zh ? "AI 脚本改写" : "AI rewrite") : (zh ? "创作任务" : "Creation task")}</p><p className="mt-1 break-all text-xs text-muted-foreground">{task.id}</p></div><div>{status(task.state)} · {task.settledCredits ?? task.credits} {zh ? "积分" : "credits"} · {task.settledRewrites ?? task.rewrites} {zh ? "次改写" : "rewrites"}</div></div>)}
    </>}
    {selected && pack && <AlipayCheckoutDialog pack={pack} requestId="" existingOrderId={selected.id} onClose={() => setSelected(null)} onPaid={() => void load()} />}
  </Container>;
}

function AccountActionDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const zh = useLocale() === "zh";
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label={title} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/50 sm:p-6">
    <header className="mb-5 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label={zh ? "关闭" : "Close"} title={zh ? "关闭" : "Close"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border disabled:opacity-50"><X className="h-4 w-4" /></button></header>
    {children}
  </dialog>;
}
