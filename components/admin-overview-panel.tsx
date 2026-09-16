"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CreditCard, LogIn, RefreshCw, UploadCloud, UserPlus, Users, Video, type LucideIcon } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value || 0);
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatCurrencyCny(amountCents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format((amountCents || 0) / 100);
}

type AdminOverview = {
  overview: {
    totalUsers: number;
    newUsersToday: number;
    newUsers7d: number;
    newUsers30d: number;
    visitorToday: number;
    visitor7d: number;
    visitor30d: number;
    signedInToday: number;
    signedIn7d: number;
    signedIn30d: number;
    purchasedUsers: number;
    nonPurchasedUsers: number;
    totalProjects: number;
    totalGenerations: number;
    totalWorkflowJobs: number;
    uploadCount: number;
    uploadBytes: number;
    analysisCount: number;
    generationCount: number;
    videoClips: number;
  };
  daily: Array<{ date: string; activeUsers: number; signedInUsers: number; uploads: number; uploadBytes: number; analyses: number; generations: number }>;
  actionCounts: Array<{ action: string; value: number }>;
  topUsers: Array<{
    userId: string;
    name: string;
    email: string | null;
    role: string | null;
    banned: boolean;
    creditBalance: number;
    actions: number;
    uploads: number;
    uploadBytes: number;
    analyses: number;
    generations: number;
    projects: number;
    clips: number;
    lastSeen: string;
  }>;
  purchasedUsers: Array<{
    userId: string;
    email: string;
    name: string | null;
    orderCount: number;
    totalPaidCents: number;
    lastPaidAt: string;
    latestPackageId: string;
    latestPackageName: string;
  }>;
  recentUsers: Array<{ id: string; name: string | null; email: string; role: string; createdAt: string }>;
  dataHealth: { degraded: boolean; unavailable: string[] };
};

function MetricCard({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</p>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#D97757]/10 text-[#D97757]">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-3xl font-semibold text-[var(--color-text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{note}</p>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {note ? <p className="text-xs text-[var(--color-text-muted)]">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminOverviewPanel() {
  const locale = useLocale();
  const zh = locale === "zh";
  const numberLocale = zh ? "zh-CN" : "en-US";
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadOverview() {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/admin/overview?days=14", { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || (zh ? "后台统计加载失败" : "Failed to load admin analytics"));
      setData(payload as AdminOverview);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setError(zh ? "后台统计查询超时，请稍后重试" : "The analytics request timed out. Please retry.");
      } else {
        setError(cause instanceof Error ? cause.message : (zh ? "后台统计加载失败" : "Failed to load admin analytics"));
      }
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const maxDaily = useMemo(() => Math.max(1, ...(data?.daily || []).flatMap((day) => [day.activeUsers, day.signedInUsers, day.uploads, day.analyses, day.generations])), [data]);

  if (loading && !data) {
    return <div className="grid min-h-[420px] place-items-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)]"><Spinner /></div>;
  }

  if (error && !data) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  }

  if (!data) return null;

  const copy = zh ? {
    title: "运营概览", description: "用户增长、付费转化与产品使用情况", refresh: "刷新", totalUsers: "总用户", newUsers: "新增用户", paidUsers: "已购买套餐", visitorDau: "访客 DAU", signedInDau: "登录用户 DAU", aiWork: "AI 任务", today: "今日", sevenDays: "近 7 天", thirtyDays: "近 30 天", conversion: "付费率", visitors: "访客", signedIn: "登录用户", analyses: "分析", generations: "生成", activityTitle: "近 14 天活跃趋势", activityNote: "访客按浏览器去重，登录用户按账号去重", uploads: "上传", paidTitle: "已到账套餐用户", paidNote: "仅统计支付状态为已到账的订单", user: "用户", package: "最近套餐", orders: "订单数", paidTotal: "累计实付", lastPaid: "最近付款", noPaid: "暂无已到账套餐用户", newTitle: "最近注册用户", latest: "最近", usageTitle: "高使用量用户", usageNote: "按近 14 天上传、生成、分析综合排序", storage: "上传量", credits: "积分", lastSeen: "最近使用", noUsage: "暂无使用记录", healthTitle: "部分统计暂不可用", healthBody: "以下数据源未能完成查询，其他指标仍正常显示：",
  } : {
    title: "Operations overview", description: "User growth, paid conversion, and product usage", refresh: "Refresh", totalUsers: "Total users", newUsers: "New users", paidUsers: "Paid users", visitorDau: "Visitor DAU", signedInDau: "Signed-in DAU", aiWork: "AI tasks", today: "Today", sevenDays: "Last 7 days", thirtyDays: "Last 30 days", conversion: "Conversion", visitors: "Visitors", signedIn: "Signed in", analyses: "Analyses", generations: "Generations", activityTitle: "14-day activity", activityNote: "Visitors are deduplicated by browser; signed-in users by account", uploads: "Uploads", paidTitle: "Paid plan users", paidNote: "Includes settled payment orders only", user: "User", package: "Latest plan", orders: "Orders", paidTotal: "Total paid", lastPaid: "Last paid", noPaid: "No settled plan purchases yet", newTitle: "Recently registered", latest: "Latest", usageTitle: "High-usage users", usageNote: "Ranked by uploads, generations, and analyses in the last 14 days", storage: "Uploaded", credits: "Credits", lastSeen: "Last seen", noUsage: "No usage yet", healthTitle: "Some metrics are unavailable", healthBody: "These data sources could not be queried. Other metrics are still available:",
  };

  const conversion = data.overview.totalUsers ? (data.overview.purchasedUsers / data.overview.totalUsers) * 100 : 0;

  return (
    <div className="mx-auto flex max-w-[1680px] min-w-0 flex-col gap-5 px-0 py-1">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{copy.title}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{copy.description}</p></div>
        <Button variant="outline" size="sm" onClick={() => void loadOverview()} disabled={loading} aria-label={copy.refresh}>{loading ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}{copy.refresh}</Button>
      </header>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {data.dataHealth?.degraded ? (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-[var(--color-text-secondary)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" /><div><p className="font-semibold text-[var(--color-text-primary)]">{copy.healthTitle}</p><p className="mt-1 text-xs">{copy.healthBody} {data.dataHealth.unavailable.join(", ")}</p></div></div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard icon={Users} label={copy.totalUsers} value={formatNumber(data.overview.totalUsers, numberLocale)} note={`${copy.thirtyDays}: +${formatNumber(data.overview.newUsers30d, numberLocale)}`} />
        <MetricCard icon={UserPlus} label={copy.newUsers} value={`+${formatNumber(data.overview.newUsersToday, numberLocale)}`} note={`${copy.sevenDays}: +${formatNumber(data.overview.newUsers7d, numberLocale)} · ${copy.thirtyDays}: +${formatNumber(data.overview.newUsers30d, numberLocale)}`} />
        <MetricCard icon={CreditCard} label={copy.paidUsers} value={formatNumber(data.overview.purchasedUsers, numberLocale)} note={`${copy.conversion}: ${conversion.toFixed(1)}%`} />
        <MetricCard icon={Activity} label={copy.visitorDau} value={formatNumber(data.overview.visitorToday, numberLocale)} note={`${copy.sevenDays}: ${formatNumber(data.overview.visitor7d, numberLocale)} · MAU: ${formatNumber(data.overview.visitor30d, numberLocale)}`} />
        <MetricCard icon={LogIn} label={copy.signedInDau} value={formatNumber(data.overview.signedInToday, numberLocale)} note={`${copy.sevenDays}: ${formatNumber(data.overview.signedIn7d, numberLocale)} · MAU: ${formatNumber(data.overview.signedIn30d, numberLocale)}`} />
        <MetricCard icon={Video} label={copy.aiWork} value={formatNumber(data.overview.analysisCount + data.overview.generationCount, numberLocale)} note={`${copy.analyses}: ${formatNumber(data.overview.analysisCount, numberLocale)} · ${copy.generations}: ${formatNumber(data.overview.generationCount, numberLocale)}`} />
      </div>

      <Section title={copy.activityTitle} note={copy.activityNote}>
        <div className="mt-4 grid gap-2">
          {data.daily.map((day) => (
            <div key={day.date} className="grid gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-base)] p-3 lg:grid-cols-[7rem_minmax(0,1fr)_7rem] lg:items-center">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{day.date}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[[copy.visitors, day.activeUsers, "bg-[#D97757]"], [copy.signedIn, day.signedInUsers, "bg-[#2F6B5F]"], [copy.uploads, day.uploads, "bg-[#7C8F7A]"], [copy.analyses, day.analyses, "bg-[#8D7DB8]"], [copy.generations, day.generations, "bg-[#4F7EA8]"]].map(([label, value, color]) => (
                  <div key={String(label)} className="min-w-0"><div className="h-2 overflow-hidden rounded-full bg-black/5"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(3, (Number(value) / maxDaily) * 100)}%` }} /></div><p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">{label}: {value}</p></div>
                ))}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] lg:text-right">{formatBytes(day.uploadBytes)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={copy.paidTitle} note={copy.paidNote}>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-[var(--color-text-muted)]"><tr className="border-b border-[var(--color-border-default)]"><th className="py-2 pr-4">{copy.user}</th><th className="py-2 pr-4">{copy.package}</th><th className="py-2 pr-4">{copy.orders}</th><th className="py-2 pr-4">{copy.paidTotal}</th><th className="py-2">{copy.lastPaid}</th></tr></thead>
            <tbody>
              {data.purchasedUsers.map((item) => <tr key={item.userId} className="border-b border-[var(--color-border-default)]/70"><td className="py-3 pr-4"><p className="font-medium text-[var(--color-text-primary)]">{item.name || item.email}</p><p className="text-xs text-[var(--color-text-muted)]">{item.email}</p></td><td className="py-3 pr-4 text-[var(--color-text-secondary)]">{item.latestPackageName}</td><td className="py-3 pr-4">{formatNumber(item.orderCount, numberLocale)}</td><td className="py-3 pr-4 font-semibold text-[#D97757]">{formatCurrencyCny(item.totalPaidCents, numberLocale)}</td><td className="py-3 text-xs text-[var(--color-text-muted)]">{new Date(item.lastPaidAt).toLocaleString(numberLocale)}</td></tr>)}
              {!data.purchasedUsers.length ? <tr><td colSpan={5} className="py-8 text-center text-[var(--color-text-muted)]">{copy.noPaid}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <Section title={copy.usageTitle} note={copy.usageNote}>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="text-xs text-[var(--color-text-muted)]"><tr className="border-b border-[var(--color-border-default)]"><th className="py-2 pr-3">{copy.user}</th><th className="py-2 pr-3">{copy.uploads}</th><th className="py-2 pr-3">{copy.storage}</th><th className="py-2 pr-3">{copy.credits}</th><th className="py-2 pr-3">{copy.analyses}</th><th className="py-2 pr-3">{copy.generations}</th><th className="py-2">{copy.lastSeen}</th></tr></thead><tbody>
            {data.topUsers.map((item) => <tr key={item.userId} className="border-b border-[var(--color-border-default)]/70"><td className="py-3 pr-3"><p className="font-medium text-[var(--color-text-primary)]">{item.name || item.email}</p><p className="max-w-48 truncate text-xs text-[var(--color-text-muted)]">{item.email}</p></td><td className="py-3 pr-3">{formatNumber(item.uploads, numberLocale)}</td><td className="py-3 pr-3">{formatBytes(item.uploadBytes)}</td><td className="py-3 pr-3 font-semibold text-[#D97757]">{formatNumber(item.creditBalance, numberLocale)}</td><td className="py-3 pr-3">{formatNumber(item.analyses, numberLocale)}</td><td className="py-3 pr-3">{formatNumber(item.generations, numberLocale)}</td><td className="py-3 text-xs text-[var(--color-text-muted)]">{new Date(item.lastSeen).toLocaleString(numberLocale)}</td></tr>)}
            {!data.topUsers.length ? <tr><td colSpan={7} className="py-8 text-center text-[var(--color-text-muted)]">{copy.noUsage}</td></tr> : null}
          </tbody></table></div>
        </Section>

        <Section title={copy.newTitle} note={`${copy.latest} ${data.recentUsers.length}`}>
          <div className="mt-3 grid gap-2">{data.recentUsers.map((item) => <div key={item.id} className="rounded-lg bg-[var(--color-bg-base)] px-3 py-2 text-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-[var(--color-text-primary)]">{item.name || item.email}</p><p className="truncate text-xs text-[var(--color-text-secondary)]">{item.email}</p></div><span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-[var(--color-text-muted)]">{item.role}</span></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">{new Date(item.createdAt).toLocaleString(numberLocale)}</p></div>)}</div>
        </Section>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4"><UploadCloud className="h-5 w-5 text-[#7C8F7A]" aria-hidden="true" /><div><p className="text-xs text-[var(--color-text-muted)]">{copy.uploads} · 14d</p><p className="font-semibold text-[var(--color-text-primary)]">{formatNumber(data.overview.uploadCount, numberLocale)} · {formatBytes(data.overview.uploadBytes)}</p></div></div>
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4"><Video className="h-5 w-5 text-[#4F7EA8]" aria-hidden="true" /><div><p className="text-xs text-[var(--color-text-muted)]">{copy.aiWork} · 14d</p><p className="font-semibold text-[var(--color-text-primary)]">{copy.analyses} {formatNumber(data.overview.analysisCount, numberLocale)} · {copy.generations} {formatNumber(data.overview.generationCount, numberLocale)}</p></div></div>
      </div>
    </div>
  );
}
