"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { AlipayCheckoutDialog } from "@/components/payments/alipay-checkout-dialog";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";

type Order = { id: string; packageId: string; packageName: string; amountCents: number; status: string; createdAt: string };
type Account = {
  wallet: { credits: number; rewrites: number; heldCredits: number; heldRewrites: number; frozen: boolean };
  orders: Order[];
  refunds: { id: string; orderId: string; state: string }[];
  tasks: { id: string; taskKey: string; state: string; credits: number; rewrites: number; settledCredits: number | null; settledRewrites: number | null; createdAt: string }[];
};

export default function BillingPage() {
  const zh = useLocale() === "zh";
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/payments/account", { cache: "no-store" });
      if (response.status === 401) { window.location.href = "/login?next=%2Fbilling"; return; }
      if (!response.ok) throw new Error();
      setAccount(await response.json()); setError("");
    } catch { setError(zh ? "暂时无法读取账户，请稍后重试。" : "Unable to load your account. Try again later."); }
  }, [zh]);
  useEffect(() => { void load(); }, [load]);
  const status = (value: string) => zh ? ({ pending: "待确认", paid: "已到账", refunded: "已退款", cancelled: "已取消", failed: "失败", requested: "退款待确认", processing: "退款处理中", succeeded: "退款成功", review: "人工复核中", held: "任务处理中", settled: "已结算" }[value] || value) : value;
  const pack = COMMERCIAL_PACKAGES.find((p) => p.id === selected?.packageId);
  async function refund() {
    if (!refundOrder || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${refundOrder.id}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: zh ? "申请退还未使用套餐" : "Refund unused package" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code === "PACKAGE_USED_OR_RESERVED" ? (zh ? "此套餐已有消耗或任务占用，不能整单退款，需要人工核对。" : "This package has usage or pending tasks. A full refund requires review.") : (zh ? "退款暂时无法确认，请保留订单号，不要重复申请。" : "Refund unconfirmed. Keep your order ID and do not submit again."));
      setRefundOrder(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 text-foreground md:px-8">
    <header className="flex items-center justify-between gap-4 border-b border-border pb-5">
      <Link href="/dashboard" className="flex items-center gap-2 text-sm"><ArrowLeft size={18} />{zh ? "工作台" : "Workspace"}</Link>
      <button onClick={() => void load()} title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新" : "Refresh"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><RefreshCw size={18} /></button>
    </header>
    <h1 className="mt-8 text-2xl font-semibold">{zh ? "余额与订单" : "Balance and orders"}</h1>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
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
            {order.status === "paid" && !refundInfo && <button className="min-h-10 rounded-lg border border-border px-3" onClick={() => setRefundOrder(order)}>{zh ? "申请退款" : "Request refund"}</button>}
          </div>
        </div>;
      })}
      {refundOrder && <section aria-label={zh ? "确认退款" : "Confirm refund"} className="border-b border-border py-6">
        <h2 className="text-lg font-semibold">{zh ? "退还此笔未使用套餐？" : "Refund this unused package?"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{zh ? "提交后会冻结该套餐的积分和改写次数，按原订单申请退款。已有消耗或处理中任务的套餐需人工核对。" : "This reserves the package benefits and requests a refund to the original payment method. Packages with usage or pending tasks require review."}</p>
        <div className="mt-4 flex gap-3"><button disabled={busy} onClick={() => void refund()} className="min-h-10 rounded-lg bg-foreground px-4 text-background disabled:opacity-50">{zh ? "确认申请" : "Confirm request"}</button><button disabled={busy} onClick={() => setRefundOrder(null)} className="px-4">{zh ? "取消" : "Cancel"}</button></div>
      </section>}
      <h2 className="mt-10 text-lg font-semibold">{zh ? "任务消费" : "Task usage"}</h2>
      {!account.tasks.length && <p className="py-6 text-sm text-muted-foreground">{zh ? "暂无任务消费" : "No task usage yet"}</p>}
      {account.tasks.map((task) => <div key={task.id} className="flex flex-wrap justify-between gap-3 border-b border-border py-4 text-sm"><div><p>{task.taskKey.startsWith("commercial:") ? <Link className="underline" href={`/billing/tasks/${task.taskKey.slice(11)}`}>{zh ? "查看创作任务" : "View creation task"}</Link> : task.taskKey.startsWith("rewrite:") ? (zh ? "AI 脚本改写" : "AI rewrite") : (zh ? "创作任务" : "Creation task")}</p><p className="mt-1 break-all text-xs text-muted-foreground">{task.id}</p></div><div>{status(task.state)} · {task.settledCredits ?? task.credits} {zh ? "积分" : "credits"} · {task.settledRewrites ?? task.rewrites} {zh ? "次改写" : "rewrites"}</div></div>)}
    </>}
    {selected && pack && <AlipayCheckoutDialog pack={pack} requestId="" existingOrderId={selected.id} onClose={() => setSelected(null)} onPaid={() => void load()} />}
  </main>;
}
