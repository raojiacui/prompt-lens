"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Shield, UploadCloud, Users, Video, WandSparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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

type AdminOverview = {
  overview: {
    totalUsers: number;
    newUsers30d: number;
    activeToday: number;
    active7d: number;
    active30d: number;
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

  async function loadOverview() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/overview?days=14", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to load admin overview");
      setData(payload as AdminOverview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin overview");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
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
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">查看用户活跃、上传流量、分析/生成使用量，先定位薅羊毛来源。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadOverview()} disabled={loading}>
          {loading ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="DAU today" value={formatNumber(data.overview.activeToday)} note={`7d active ${formatNumber(data.overview.active7d)} · 30d active ${formatNumber(data.overview.active30d)}`} />
        <MetricCard icon={Shield} label="Users" value={formatNumber(data.overview.totalUsers)} note={`New in 30d ${formatNumber(data.overview.newUsers30d)}`} />
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
                  <tr><td className="py-6 text-center text-[var(--color-text-muted)]" colSpan={11}>No usage yet</td></tr>
                ) : null}
              </tbody>
            </table>
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
  );
}