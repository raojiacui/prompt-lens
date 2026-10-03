"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AdminDirectoryUser, AdminFinancialPage } from "@/lib/admin/user-directory-types";

export function AdminFinancialRecords({ user, zh, onClose }: { user: AdminDirectoryUser; zh: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [kind, setKind] = useState<"orders" | "ledger">("orders");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminFinancialPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const locale = zh ? "zh-CN" : "en-US";
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setData(null); setLoading(true); setError(false);
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    void fetch(`/api/admin/users/${user.id}/credits?kind=${kind}&page=${page}&limit=20`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); const body = await response.json(); if (!controller.signal.aborted) setData(body); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { window.clearTimeout(timeout); if (!controller.signal.aborted) setLoading(false); });
    controller.signal.addEventListener("abort", () => { if (active) { setError(true); setLoading(false); } }, { once: true });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [user.id, kind, page, retry]);
  const statuses: Record<string, string> = zh ? { pending: "待支付", paid: "已到账", cancelled: "已取消", failed: "失败", refunded: "已退款", payment_grant: "购买到账", manual_grant: "人工赠送", admin_adjustment: "积分调整", feature_usage: "功能扣费" } : {};
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-label={zh ? "订单与积分流水" : "Orders and credit ledger"} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl overflow-y-auto rounded-lg border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-3"><h3 className="min-w-0 break-all font-semibold">{user.email}</h3><Button size="icon" variant="ghost" title={zh ? "关闭" : "Close"} aria-label={zh ? "关闭" : "Close"} onClick={onClose}><X className="h-4 w-4" /></Button></div>
    <p className="mt-2 break-all text-sm text-muted-foreground">{user.name || "--"} · {zh ? "账户编号：" : "Account ID: "}{user.id}</p>
    {user.commercialBalance !== undefined && <p className="mt-2 text-sm">{zh ? "V2 剩余积分：" : "V2 credits: "}{user.commercialBalance} · {zh ? "预留积分：" : "Reserved credits: "}{user.heldCredits || 0}</p>}
    <div role="tablist" className="mt-3 flex gap-1" aria-label={zh ? "财务记录" : "Financial records"}>{(["orders","ledger"] as const).map(tab => <button key={tab} role="tab" aria-selected={kind===tab} onClick={() => { setKind(tab); setPage(1); }} className={`rounded-md px-3 py-2 text-sm ${kind===tab ? "bg-[var(--color-text-primary)] text-[var(--color-bg-base)]" : "text-[var(--color-text-secondary)]"}`}>{tab==="orders" ? (zh ? "全部订单" : "All orders") : (zh ? "积分流水" : "Credit ledger")}</button>)}</div>
    <div role="tabpanel" aria-busy={loading} className="mt-3 min-h-[140px] overflow-x-auto">
      {loading ? <div className="grid h-36 place-items-center"><Spinner /></div> : error ? <div role="alert" className="flex items-center gap-3 py-5 text-sm text-destructive">{zh ? "记录加载失败，请重试" : "Unable to load records"}<Button variant="outline" size="icon" title={zh ? "重试" : "Retry"} aria-label={zh ? "重试" : "Retry"} onClick={() => setRetry(n=>n+1)}><RefreshCw className="h-4 w-4" /></Button></div> :
      <table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs text-[var(--color-text-muted)]">{(zh ? ["时间","订单号 / 流水来源","状态 / 类型","套餐 / 备注","金额","积分"] : ["Time","Order / Ledger source","Status / Type","Plan / Note","Amount","Credits"]).map(label=><th key={label} className="py-3 pr-4">{label}</th>)}</tr></thead>
        <tbody>{data?.entries.map(entry=><tr key={`${entry.kind}:${entry.id}`} className="border-b border-[var(--color-border-default)]/70">
          <td className="whitespace-nowrap py-3 pr-4">{new Date(entry.createdAt).toLocaleString(locale)}{entry.paidAt && <p className="text-xs text-[var(--color-text-muted)]">{zh ? "到账：" : "Paid: "}{new Date(entry.paidAt).toLocaleString(locale)}</p>}</td>
          <td className="max-w-64 break-all py-3 pr-4"><p>{entry.reference || entry.id}</p>{entry.tradeReference && entry.tradeReference!==entry.reference && <p className="text-xs">{zh ? "支付流水：" : "Provider transaction: "}{entry.tradeReference}</p>}<p className="text-xs text-[var(--color-text-muted)]">{entry.provider || (entry.kind==="legacy" ? (zh ? "原版账本" : "Legacy ledger") : (zh ? "V2 账本" : "V2 ledger"))}{entry.actorEmail ? ` · ${entry.actorEmail}` : ""}</p></td>
          <td className="max-w-48 break-all py-3 pr-4">{statuses[entry.status || ""] || (zh ? entry.status?.replace(/^purchase:.*/,"购买到账").replace(/^settle:.*/,"功能扣费").replace(/^refund-hold:.*/,"退款预留").replace(/^refund-reject:.*/,"退款驳回返还").replace(/^refund-approve:.*/,"退款审批") : entry.status)}</td>
          <td className="max-w-60 break-words py-3 pr-4">{entry.packageName || entry.note || "--"}</td>
          <td className="whitespace-nowrap py-3 pr-4">{entry.amountCents === null || entry.amountCents === undefined ? "--" : `${(entry.amountCents/100).toFixed(2)} ${(entry.currency || "").toUpperCase()}`}</td>
          <td className="whitespace-nowrap py-3 pr-4">{kind==="ledger" && entry.credits>0 ? "+" : ""}{entry.credits}</td>
        </tr>)}{!data?.entries.length && <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">{zh ? "没有记录" : "No records"}</td></tr>}</tbody></table>}
    </div>
    <div className="mt-3 flex items-center justify-end gap-2"><span className="mr-2 text-sm text-[var(--color-text-muted)]">{data?.total ?? "--"} {zh ? "条" : "records"}</span><Button size="icon" variant="outline" disabled={loading || error || page<=1} title={zh ? "上一页" : "Previous"} aria-label={zh ? "上一页" : "Previous"} onClick={()=>setPage(n=>n-1)}><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-16 text-center text-sm">{page} / {pages}</span><Button size="icon" variant="outline" disabled={loading || error || page>=pages} title={zh ? "下一页" : "Next"} aria-label={zh ? "下一页" : "Next"} onClick={()=>setPage(n=>n+1)}><ChevronRight className="h-4 w-4" /></Button></div>
  </dialog>;
}
