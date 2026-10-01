"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AdminDirectoryUser, AdminUserPage, AdminUserView } from "@/lib/admin/user-directory-types";

export function AdminUserDirectory() {
  const zh = useLocale() === "zh";
  const locale = zh ? "zh-CN" : "en-US";
  const [params, setParams] = useState({ view: "all" as AdminUserView, page: 1, limit: 20, query: "" });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AdminUserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const copy = zh ? {
    title: "用户明细", all: "全部用户", paid: "付费用户", usage: "使用排行", search: "搜索姓名或邮箱", submit: "搜索", size: "每页条数",
    user: "用户", status: "状态", joined: "注册时间", analyses: "分析次数", plan: "最近套餐", orders: "订单数", amount: "累计实付", lastPaid: "最近付款",
    uploads: "上传次数", bytes: "上传量", generations: "生成次数", credits: "剩余积分", lastSeen: "最近使用", empty: "暂无匹配用户", loading: "加载中",
    previous: "上一页", next: "下一页", retry: "重试", failed: "用户明细加载失败，请重试", timeout: "用户明细查询超时，请重试", banned: "已封禁", active: "正常",
    incomplete: "部分使用数据暂不可用：", paidNote: "已到账订单", usageNote: "近 14 天",
  } : {
    title: "User directory", all: "All users", paid: "Paid users", usage: "Usage ranking", search: "Search name or email", submit: "Search", size: "Rows per page",
    user: "User", status: "Status", joined: "Registered", analyses: "Analyses", plan: "Latest plan", orders: "Orders", amount: "Total paid", lastPaid: "Last paid",
    uploads: "Uploads", bytes: "Uploaded", generations: "Generations", credits: "Credits", lastSeen: "Last seen", empty: "No matching users", loading: "Loading",
    previous: "Previous page", next: "Next page", retry: "Retry", failed: "Unable to load users. Please retry.", timeout: "The user request timed out. Please retry.", banned: "Banned", active: "Active",
    incomplete: "Some usage data is unavailable: ", paidNote: "Settled orders", usageNote: "Last 14 days",
  };

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setData(null);
    setError("");
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const query = new URLSearchParams({ view: params.view, page: String(params.page), limit: String(params.limit), q: params.query });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/users?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(copy.failed);
        if (current && !controller.signal.aborted) setData(body as AdminUserPage);
      } catch (cause) {
        if (current) setError(controller.signal.aborted ? copy.timeout : cause instanceof Error ? cause.message : copy.failed);
      } finally {
        window.clearTimeout(timeout);
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; window.clearTimeout(timeout); controller.abort(); };
  }, [params, retry, zh]);

  const number = (value?: number) => new Intl.NumberFormat(locale).format(value || 0);
  const date = (value?: string) => value ? new Date(value).toLocaleString(locale) : "--";
  const bytes = (value?: number) => `${number(Math.round((value || 0) / 1024 / 1024 * 10) / 10)} MB`;
  const money = (value?: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format((value || 0) / 100);
  const columns: Array<{ label: string; value: (user: AdminDirectoryUser) => string }> = params.view === "all" ? [
    { label: copy.status, value: user => user.banned ? copy.banned : copy.active },
    { label: copy.joined, value: user => date(user.createdAt) },
    { label: copy.analyses, value: user => number(user.analysisCount) },
  ] : params.view === "paid" ? [
    { label: copy.plan, value: user => user.latestPackageName || "--" },
    { label: copy.orders, value: user => number(user.orderCount) },
    { label: copy.amount, value: user => money(user.totalPaidCents) },
    { label: copy.lastPaid, value: user => date(user.lastPaidAt) },
  ] : [
    { label: copy.uploads, value: user => number(user.uploads) },
    { label: copy.bytes, value: user => bytes(user.uploadBytes) },
    { label: copy.analyses, value: user => number(user.analyses) },
    { label: copy.generations, value: user => number(user.generations) },
    { label: copy.credits, value: user => number(user.creditBalance) },
    { label: copy.lastSeen, value: user => date(user.lastSeen) },
  ];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / params.limit));
  return (
    <section aria-label={copy.title} className="min-w-0 border-t border-[var(--color-border-default)] py-5">
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={copy.title} className="flex flex-wrap gap-1">
          {(["all", "paid", "usage"] as const).map(view => <button key={view} role="tab" aria-selected={params.view === view} className={`rounded-md px-3 py-2 text-sm ${params.view === view ? "bg-[var(--color-text-primary)] text-[var(--color-bg-base)]" : "text-[var(--color-text-secondary)] hover:bg-black/5"}`} onClick={() => setParams(old => ({ ...old, view, page: 1 }))}>{copy[view]}</button>)}
        </div>
        <form className="flex w-full gap-2 sm:w-auto" onSubmit={event => { event.preventDefault(); setParams(old => ({ ...old, query: search.trim(), page: 1 })); }}>
          <input aria-label={copy.search} placeholder={copy.search} maxLength={128} value={search} onChange={event => setSearch(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] px-3 text-sm sm:w-64" />
          <Button type="submit" variant="outline" size="icon" aria-label={copy.submit} title={copy.submit}><Search className="h-4 w-4" /></Button>
        </form>
      </div>
      {params.view !== "all" && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{params.view === "paid" ? copy.paidNote : copy.usageNote}</p>}
      {data?.dataHealth.degraded && <p role="status" className="mt-3 text-sm text-amber-700">{copy.incomplete}{data.dataHealth.unavailable.join(", ")}</p>}
      <div role="tabpanel" aria-busy={loading} className="mt-3 min-h-[180px] overflow-x-auto">
        {loading ? <div role="status" aria-label={copy.loading} className="grid h-[180px] place-items-center"><Spinner /></div> : error ?
          <div role="alert" className="flex flex-wrap items-center gap-3 py-5 text-sm text-destructive">{error}<Button size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />{copy.retry}</Button></div> :
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)]"><th className="py-3 pr-4">{copy.user}</th>{columns.map(column => <th key={column.label} className="whitespace-nowrap py-3 pr-4">{column.label}</th>)}</tr></thead>
            <tbody>{data?.users.map(user => <tr key={user.id} className="border-b border-[var(--color-border-default)]/70"><td className="max-w-72 py-3 pr-4"><p className="break-words font-medium">{user.name || user.email}</p><p className="break-all text-xs text-[var(--color-text-muted)]">{user.email}</p></td>{columns.map(column => <td key={column.label} className="whitespace-nowrap py-3 pr-4 text-[var(--color-text-secondary)]">{column.value(user)}</td>)}</tr>)}
              {!data?.users.length && <tr><td colSpan={columns.length + 1} className="py-10 text-center text-[var(--color-text-muted)]">{copy.empty}</td></tr>}
            </tbody>
          </table>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2">{copy.size}<select aria-label={copy.size} value={params.limit} onChange={event => setParams(old => ({ ...old, limit: Number(event.target.value), page: 1 }))} className="h-9 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] px-2">{[20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <div aria-live="polite" className="text-[var(--color-text-muted)]">{data ? `${data.total ? (params.page - 1) * params.limit + 1 : 0}–${Math.min(params.page * params.limit, data.total)} / ${number(data.total)}` : "--"}</div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" title={copy.previous} aria-label={copy.previous} disabled={loading || !!error || params.page <= 1} onClick={() => setParams(old => ({ ...old, page: old.page - 1 }))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-16 text-center">{params.page} / {data ? pages : "--"}</span>
          <Button size="icon" variant="outline" title={copy.next} aria-label={copy.next} disabled={loading || !!error || params.page >= pages} onClick={() => setParams(old => ({ ...old, page: old.page + 1 }))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </section>
  );
}
