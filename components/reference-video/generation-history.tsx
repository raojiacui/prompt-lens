"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { generationDisplayName } from "@/lib/ai/generation-models";
import { refreshWalletBalance } from "@/lib/billing/use-wallet-balance";

type Record = { id: string; taskId: string; model: string | null; prompt: string | null; duration: string | null; resolution: string | null; status: string; videoUrl: string | null; error: string | null; payer: string; credits: number; createdAt: string };
const pending = (status: string) => ["pending", "queued", "processing", "running", "review"].includes(status);

export function GenerationHistory({ refreshKey }: { refreshKey: string }) {
  const zh = useLocale() === "zh";
  const [records, setRecords] = useState<Record[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/generation-history?page=${page}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (signal?.aborted) return;
      if (!Array.isArray(data.history)) throw new Error();
      setRecords(data.history); setHasMore(Boolean(data.hasMore)); setRetentionDays(data.retentionDays ?? null); setError("");
    } catch {
      if (!signal?.aborted) setError(zh ? "生成历史暂时无法加载，请重试。" : "Unable to load generation history. Please retry.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [page, zh]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);
  async function check(record: Record) {
    if (checking) return;
    setChecking(record.id);
    try {
      const url = record.payer === "platform" ? `/api/commercial/tasks/${record.taskId.slice(11)}` : `/api/generation-jobs?taskId=${encodeURIComponent(record.taskId)}`;
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error();
      await load();
      if (record.payer === "platform") refreshWalletBalance();
    } catch { setError(zh ? "任务状态查询失败，请稍后重试。" : "Unable to check task status. Please retry."); }
    finally { setChecking(null); }
  }
  function status(value: string) {
    if (["completed", "success"].includes(value)) return zh ? "已完成" : "Completed";
    if (["failed", "fail"].includes(value)) return zh ? "失败" : "Failed";
    if (value === "review") return zh ? "状态待核实" : "Under review";
    return zh ? "生成中" : "Generating";
  }
  return <section aria-label={zh ? "生成历史" : "Generation history"} className="border-t border-border pt-6">
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{zh ? "生成历史" : "Generation history"}</h2>
      <button type="button" disabled={loading} onClick={() => void load()} aria-label={zh ? "刷新生成历史" : "Refresh generation history"} title={zh ? "刷新生成历史" : "Refresh generation history"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border disabled:opacity-50"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
    </header>
    {retentionDays && <p className="mt-2 text-sm text-muted-foreground">{zh ? "生成记录保存 7 天，请及时下载视频。视频链接有效期以服务商为准。" : "Generation records are kept for 7 days. Download videos promptly; link validity depends on the provider."}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {!records.length && <p role="status" className="py-6 text-sm text-muted-foreground">{loading ? (zh ? "加载中…" : "Loading…") : error ? "" : (zh ? "暂无生成记录" : "No generation history yet")}</p>}
    {records.map(record => <div key={record.id} className="border-b border-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{record.model ? generationDisplayName(record.model) : (zh ? "视频生成" : "Video generation")}</p><p className="mt-1 text-sm text-muted-foreground">{new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")} · {record.duration ?? "—"}s · {record.resolution ?? "—"}</p><p className="mt-1 text-sm">{status(record.status)} · {record.payer === "platform" ? `${pending(record.status) ? (zh ? "预留 " : "Reserved ") : ""}${record.credits} ${zh ? "积分" : "credits"}` : (zh ? "自己的 Key · 0 平台积分" : "Own key · 0 platform credits")}</p></div>
        <div className="flex items-center gap-3">{pending(record.status) && <button type="button" disabled={!!checking} onClick={() => void check(record)} title={zh ? "查询任务状态" : "Check task status"} aria-label={zh ? "查询任务状态" : "Check task status"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border disabled:opacity-50"><RefreshCw size={18} className={checking === record.id ? "animate-spin" : ""} /></button>}<button type="button" aria-expanded={selected === record.id} onClick={() => setSelected(selected === record.id ? null : record.id)} className="min-h-10 px-3 text-sm underline">{selected === record.id ? (zh ? "收起" : "Collapse") : (zh ? "查看结果" : "View result")}</button></div>
      </div>
      {selected === record.id && <div className="mt-4 space-y-3">
        <p className="break-all text-xs text-muted-foreground">{record.taskId}</p>
        <pre className="whitespace-pre-wrap break-words text-sm font-sans">{record.prompt}</pre>
        {record.error && <p role="alert" className="text-sm text-destructive">{record.error}</p>}
        {record.videoUrl && <><video src={record.videoUrl} controls playsInline preload="metadata" className="aspect-video w-full max-w-3xl bg-black object-contain" /><a href={record.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline">{zh ? "打开视频" : "Open video"}</a></>}
      </div>}
    </div>)}
    {(page > 1 || hasMore) && <nav aria-label={zh ? "生成历史分页" : "History pages"} className="flex items-center justify-end gap-3 py-4"><button type="button" disabled={page === 1 || loading} onClick={() => { setSelected(null); setPage(page - 1); }} title={zh ? "上一页" : "Previous page"} aria-label={zh ? "上一页" : "Previous page"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border disabled:opacity-40"><ChevronLeft size={18} /></button><span className="text-sm">{page}</span><button type="button" disabled={!hasMore || loading} onClick={() => { setSelected(null); setPage(page + 1); }} title={zh ? "下一页" : "Next page"} aria-label={zh ? "下一页" : "Next page"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border disabled:opacity-40"><ChevronRight size={18} /></button></nav>}
  </section>;
}
