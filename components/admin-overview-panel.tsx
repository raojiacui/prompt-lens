"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Coins, CreditCard, Package, ReceiptText, RefreshCw, Send, Shield, UploadCloud, Users, Video, WandSparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CREDIT_PACKAGES } from "@/lib/billing/credit-packages";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
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

function formatCurrencyCny(amountCents: number) {
  return `¥${((amountCents || 0) / 100).toFixed(2)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function valueText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function methodLabel(value: string) {
  if (value === "wechat") return "微信";
  if (value === "alipay") return "支付宝";
  return value || "国内收款码";
}

type AdminOverview = {
  overview: {
    totalUsers: number;
    newUsers30d: number;
    activeToday: number;
    active7d: number;
    active30d: number;
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
  daily: Array<{ date: string; activeUsers: number; uploads: number; uploadBytes: number; analyses: number; generations: number }>;
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
  recentUsers: Array<{ id: string; name: string | null; email: string; role: string; createdAt: string }>;
};

type ManualPaymentOrder = {
  id: string;
  userId: string;
  providerOrderId: string;
  packageId: string;
  packageName: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: string;
  rawPayload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { email: string; name: string | null };
};

function manualPaymentDetails(order: ManualPaymentOrder) {
  const metadata = asRecord(order.metadata);
  const rawPayload = asRecord(order.rawPayload);
  return {
    method: valueText(metadata.method) || valueText(rawPayload.method),
    paymentReference: valueText(metadata.paymentReference) || valueText(rawPayload.paymentReference),
    contact: valueText(metadata.contact) || valueText(rawPayload.contact),
    note: valueText(metadata.note) || valueText(rawPayload.note),
  };
}

function MetricCard({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</p>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#D97757]/10 text-[#D97757]">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-3xl font-semibold text-[var(--color-text-primary)]">{value}</p>
      {note ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{note}</p> : null}
    </div>
  );
}

export function AdminOverviewPanel() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [manualPayments, setManualPayments] = useState<ManualPaymentOrder[]>([]);
  const [manualPaymentLoading, setManualPaymentLoading] = useState(false);
  const [manualPaymentMessage, setManualPaymentMessage] = useState("");
  const [confirmingOrderId, setConfirmingOrderId] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPackageId, setGrantPackageId] = useState(CREDIT_PACKAGES[1]?.id || "");
  const [grantAmount, setGrantAmount] = useState(String(CREDIT_PACKAGES[1]?.credits || 30));
  const [grantProvider, setGrantProvider] = useState("manual_qr");
  const [grantReference, setGrantReference] = useState("");
  const [grantNote, setGrantNote] = useState("国内扫码付款，后台确认后发放");
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantMessage, setGrantMessage] = useState("");

  async function fetchJsonWithTimeout(url: string, timeoutMessage: string, init: RequestInit = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(timeoutMessage);
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  async function loadOverview() {
    setLoading(true);
    setError("");
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/admin/overview?days=14", "后台统计查询超时，请稍后重试", { cache: "no-store" });
      if (!response.ok) throw new Error(payload.error || "Failed to load admin overview");
      setData(payload as AdminOverview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin overview");
    } finally {
      setLoading(false);
    }
  }

  async function loadManualPayments() {
    setManualPaymentLoading(true);
    setManualPaymentMessage("");
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/admin/payments/manual?status=pending", "待确认付款加载超时", { cache: "no-store" });
      if (!response.ok) throw new Error(payload.error || "待确认付款加载失败");
      setManualPayments(Array.isArray(payload.orders) ? payload.orders as ManualPaymentOrder[] : []);
    } catch (err) {
      setManualPaymentMessage(err instanceof Error ? err.message : "待确认付款加载失败");
    } finally {
      setManualPaymentLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadOverview(), loadManualPayments()]);
  }

  function handlePackageChange(packageId: string) {
    setGrantPackageId(packageId);
    const pkg = CREDIT_PACKAGES.find((item) => item.id === packageId);
    if (pkg) setGrantAmount(String(pkg.credits));
  }

  async function submitCreditGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGrantLoading(true);
    setGrantMessage("");
    try {
      const response = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: grantEmail,
          packageId: grantPackageId,
          amount: Number(grantAmount),
          paymentProvider: grantProvider,
          paymentReference: grantReference,
          note: grantNote,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "发放失败");
      setGrantMessage(`已给 ${payload.user?.email || grantEmail} 发放 ${grantAmount} 积分，当前余额 ${payload.credits?.balance ?? "-"}`);
      setGrantReference("");
      await refreshAll();
    } catch (err) {
      setGrantMessage(err instanceof Error ? err.message : "发放失败");
    } finally {
      setGrantLoading(false);
    }
  }

  async function confirmManualPayment(orderId: string) {
    setConfirmingOrderId(orderId);
    setManualPaymentMessage("");
    try {
      const response = await fetch("/api/admin/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "确认付款失败");
      setManualPaymentMessage(payload.granted ? "已确认到账并自动发放积分" : "订单已是已支付状态，未重复发放积分");
      await refreshAll();
    } catch (err) {
      setManualPaymentMessage(err instanceof Error ? err.message : "确认付款失败");
    } finally {
      setConfirmingOrderId("");
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  const maxDaily = useMemo(() => {
    return Math.max(1, ...(data?.daily || []).map((day) => Math.max(day.activeUsers, day.uploads, day.analyses, day.generations)));
  }, [data]);

  if (loading && !data) {
    return (
      <div className="grid min-h-[520px] place-items-center rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)]">
        <Spinner />
      </div>
    );
  }

  if (error && !data) {
    return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  }

  if (!data) return null;

  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">运营后台</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">查看总用户、最近注册、待确认付款、上传流量、分析/生成使用量。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={loading || manualPaymentLoading}>
          {loading || manualPaymentLoading ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <section className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">后台发放积分</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">国内用户可以扫码付款，你确认到账后在这里按邮箱一键发放；海外自动支付后也会走同一套积分流水。</p>
          </div>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#D97757]/10 text-[#D97757]">
            <Coins className="h-4 w-4" />
          </div>
        </div>
        <form onSubmit={submitCreditGrant} className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr_0.7fr_0.9fr_1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="grant-email">用户邮箱</Label>
            <Input id="grant-email" value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="user@example.com" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-package">积分包</Label>
            <Select id="grant-package" value={grantPackageId} onChange={(event) => handlePackageChange(event.target.value)}>
              {CREDIT_PACKAGES.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.name} · {pkg.credits} 积分 · ¥{pkg.priceCny}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-amount">积分</Label>
            <Input id="grant-amount" type="number" min="1" step="1" value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-provider">收款方式</Label>
            <Select id="grant-provider" value={grantProvider} onChange={(event) => setGrantProvider(event.target.value)}>
              <option value="manual_qr">国内收款码</option>
              <option value="stripe">Stripe</option>
              <option value="creem">Creem</option>
              <option value="manual_other">其他人工确认</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-reference">付款备注/流水号</Label>
            <Input id="grant-reference" value={grantReference} onChange={(event) => setGrantReference(event.target.value)} placeholder="可选" />
          </div>
          <Button type="submit" disabled={grantLoading} className="h-10">
            {grantLoading ? <Spinner size="sm" className="mr-2" /> : <Send className="mr-2 h-4 w-4" />}
            发放
          </Button>
          <div className="space-y-1.5 lg:col-span-6">
            <Label htmlFor="grant-note">内部备注</Label>
            <Input id="grant-note" value={grantNote} onChange={(event) => setGrantNote(event.target.value)} />
          </div>
        </form>
        {grantMessage ? <p className="mt-3 rounded-xl bg-[var(--color-bg-base)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{grantMessage}</p> : null}
      </section>

      <section className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">待确认付款</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">用户在价格页提交微信/支付宝付款信息后，会出现在这里。确认到账后自动发放对应积分。</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadManualPayments()} disabled={manualPaymentLoading}>
            {manualPaymentLoading ? <Spinner size="sm" className="mr-2" /> : <ReceiptText className="mr-2 h-4 w-4" />}
            刷新付款
          </Button>
        </div>
        {manualPaymentMessage ? <p className="mt-3 rounded-xl bg-[var(--color-bg-base)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{manualPaymentMessage}</p> : null}
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {manualPaymentLoading ? (
            <div className="grid min-h-24 place-items-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-base)]"><Spinner size="sm" /></div>
          ) : manualPayments.length ? manualPayments.map((order) => {
            const detail = manualPaymentDetails(order);
            return (
              <div key={order.id} className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-base)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--color-text-primary)]">{order.packageName} · {order.credits} 积分 · {formatCurrencyCny(order.amountCents)}</p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{order.user.email}</p>
                    <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">{order.providerOrderId}</p>
                  </div>
                  <span className="rounded-full bg-[#D97757]/10 px-2.5 py-1 text-xs font-semibold text-[#D97757]">{methodLabel(detail.method)}</span>
                </div>
                <div className="mt-3 grid gap-1.5 text-xs text-[var(--color-text-secondary)] sm:grid-cols-2">
                  <p>付款备注：{detail.paymentReference || "未填"}</p>
                  <p>联系方式：{detail.contact || "未填"}</p>
                  <p>提交时间：{new Date(order.createdAt).toLocaleString()}</p>
                  <p>说明：{detail.note || "无"}</p>
                </div>
                <Button className="mt-3 h-9 bg-[#D97757] text-white hover:bg-[#C96848]" onClick={() => void confirmManualPayment(order.providerOrderId)} disabled={Boolean(confirmingOrderId)}>
                  {confirmingOrderId === order.providerOrderId ? <Spinner size="sm" className="mr-2" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  确认到账并发积分
                </Button>
              </div>
            );
          }) : (
            <div className="rounded-xl border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-base)] p-5 text-sm text-[var(--color-text-muted)]">暂无待确认付款</div>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="DAU today" value={formatNumber(data.overview.activeToday)} note={`7d active ${formatNumber(data.overview.active7d)} · 30d active ${formatNumber(data.overview.active30d)}`} />
        <MetricCard icon={CreditCard} label="已购买套餐" value={formatNumber(data.overview.purchasedUsers)} note={`占总用户 ${data.overview.totalUsers ? Math.round((data.overview.purchasedUsers / data.overview.totalUsers) * 100) : 0}%`} />
        <MetricCard icon={Package} label="未购买套餐" value={formatNumber(data.overview.nonPurchasedUsers)} note={`新用户 30d ${formatNumber(data.overview.newUsers30d)}`} />
        <MetricCard icon={Shield} label="总用户" value={formatNumber(data.overview.totalUsers)} note={`New in 30d ${formatNumber(data.overview.newUsers30d)}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={UploadCloud} label="Uploads in 14d" value={formatBytes(data.overview.uploadBytes)} note={`${formatNumber(data.overview.uploadCount)} uploaded files`} />
        <MetricCard icon={Video} label="AI work in 14d" value={formatNumber(data.overview.analysisCount + data.overview.generationCount)} note={`${formatNumber(data.overview.analysisCount)} analyses · ${formatNumber(data.overview.generationCount)} generations`} />
      </div>

      <section className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Daily activity</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Last 14 days</p>
        </div>
        <div className="mt-4 grid gap-2">
          {data.daily.map((day) => (
            <div key={day.date} className="grid gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-base)] p-3 md:grid-cols-[8rem_1fr_9rem] md:items-center">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{day.date}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  ["DAU", day.activeUsers, "bg-[#D97757]"],
                  ["Upload", day.uploads, "bg-[#7C8F7A]"],
                  ["Analyze", day.analyses, "bg-[#8D7DB8]"],
                  ["Gen", day.generations, "bg-[#4F7EA8]"],
                ].map(([label, value, color]) => (
                  <div key={label as string} className="min-w-0">
                    <div className="h-2 overflow-hidden rounded-full bg-black/5">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(4, (Number(value) / maxDaily) * 100)}%` }} />
                    </div>
                    <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">{label}: {value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] md:text-right">{formatBytes(day.uploadBytes)}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">用户使用排行</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">按近 14 天上传体积、生成数、分析数排序，邮箱直接展示。</p>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">Top {data.topUsers.length}</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr className="border-b border-[var(--color-border-default)]">
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Uploads</th>
                  <th className="py-2 pr-3">Storage</th>
                  <th className="py-2 pr-3">Credits</th>
                  <th className="py-2 pr-3">Analyses</th>
                  <th className="py-2 pr-3">Gen</th>
                  <th className="py-2 pr-3">Projects</th>
                  <th className="py-2 pr-3">Clips</th>
                  <th className="py-2 pr-3">Actions</th>
                  <th className="py-2 pr-3">Last seen</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map((user) => (
                  <tr key={user.userId} className="border-b border-[var(--color-border-default)]/70">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-[var(--color-text-primary)]">{user.name || "Unknown"}</p>
                      <p className="font-mono text-[10px] text-[var(--color-text-muted)]">{user.userId.slice(0, 8)}</p>
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-text-secondary)]">{user.email || "No email"}</td>
                    <td className="py-2 pr-3">{formatNumber(user.uploads)}</td>
                    <td className="py-2 pr-3">{formatBytes(user.uploadBytes)}</td>
                    <td className="py-2 pr-3 font-semibold text-[#D97757]">{formatNumber(user.creditBalance)}</td>
                    <td className="py-2 pr-3">{formatNumber(user.analyses)}</td>
                    <td className="py-2 pr-3">{formatNumber(user.generations)}</td>
                    <td className="py-2 pr-3">{formatNumber(user.projects)}</td>
                    <td className="py-2 pr-3">{formatNumber(user.clips)}</td>
                    <td className="py-2 pr-3">{formatNumber(user.actions)}</td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)]">{new Date(user.lastSeen).toLocaleString()}</td>
                    <td className="py-2 pr-3">{user.banned ? "Banned" : user.role || "user"}</td>
                  </tr>
                ))}
                {!data.topUsers.length ? (
                  <tr><td className="py-6 text-center text-[var(--color-text-muted)]" colSpan={12}>No usage yet</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-4">
          <section className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">最近注册用户</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Latest {data.recentUsers.length}</p>
            </div>
            <div className="mt-3 grid gap-2">
              {data.recentUsers.map((item) => (
                <div key={item.id} className="rounded-xl bg-[var(--color-bg-base)] px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--color-text-primary)]">{item.name || "Unknown user"}</p>
                      <p className="truncate text-xs text-[var(--color-text-secondary)]">{item.email}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-[var(--color-text-muted)]">{item.role}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              ))}
              {!data.recentUsers.length ? <p className="rounded-xl bg-[var(--color-bg-base)] px-3 py-4 text-sm text-[var(--color-text-muted)]">暂无用户</p> : null}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Event mix</h2>
            <div className="mt-3 grid gap-2">
              {data.actionCounts.slice(0, 10).map((item) => (
                <div key={item.action} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-bg-base)] px-3 py-2 text-sm">
                  <span className="text-[var(--color-text-secondary)]">{item.action}</span>
                  <span className="font-semibold text-[var(--color-text-primary)]">{formatNumber(item.value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-[#D97757]/25 bg-[#D97757]/10 p-3 text-sm text-[var(--color-text-secondary)]">
              <div className="flex items-center gap-2 font-semibold text-[var(--color-text-primary)]"><WandSparkles className="h-4 w-4 text-[#D97757]" /> Next protection step</div>
              <p className="mt-1 text-xs leading-relaxed">建议下一步加每日免费额度、单用户上传 GB 上限、KIE 调用次数上限，以及异常用户一键封禁。</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}