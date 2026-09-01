"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatDate, truncate } from "@/lib/utils";
import { ArrowLeft, FileVideo, Image as ImageIcon, Search } from "lucide-react";

type ProjectSample = {
  id: string;
  mediaType: "video" | "image" | string;
  title: string;
  status: string;
  mediaName: string | null;
  mediaUrl: string | null;
  prompt: string | null;
  summary: string | null;
  sceneCount: number;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
};

type Filter = "all" | "video" | "image";

export function SamplesGallery() {
  const [records, setRecords] = useState<ProjectSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    async function loadSamples() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/samples?limit=60", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Failed to load samples");
        if (!cancelled) setRecords(Array.isArray(data?.samples) ? data.samples : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load samples");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSamples();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesType = filter === "all" || record.mediaType === filter;
      if (!matchesType) return false;
      if (!keyword) return true;
      return [record.title, record.mediaName, record.summary, record.prompt]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [filter, records, search]);

  const videoCount = records.filter((record) => record.mediaType === "video").length;
  const imageCount = records.filter((record) => record.mediaType === "image").length;

  return (
    <main className="min-h-screen bg-[var(--color-bg-base)] px-5 pb-16 pt-24 text-[var(--color-text-primary)] md:px-10 lg:px-14">
      <div className="mx-auto max-w-[1720px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-normal md:text-5xl">样例</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--color-text-secondary)]">
              这里展示视频分析 Projects 中精选的公开项目，访客可以直接浏览素材、场景结构和可复用提示词方向。
            </p>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold text-[#B76442] transition-colors hover:text-[#8F4630]">
            <ArrowLeft className="h-5 w-5" />
            返回
          </Link>
        </div>

        <section className="mt-8 flex flex-col gap-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)]/80 p-4 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "all", label: `全部 ${records.length}` },
              { key: "video", label: `视频 ${videoCount}` },
              { key: "image", label: `图片 ${imageCount}` },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key as Filter)}
                className={cn(
                  "h-10 rounded-full px-4 text-sm font-semibold transition-colors",
                  filter === item.key ? "bg-[#B76442] text-white shadow-sm" : "bg-white text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-white px-4 text-[var(--color-text-secondary)] shadow-sm md:w-[360px]">
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索项目名或提示词"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            />
          </label>
        </section>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : filteredRecords.length ? (
          <div className="mt-8 grid grid-cols-1 gap-7 sm:grid-cols-2 xl:grid-cols-3">
            {filteredRecords.map((record) => (
              <SampleCard key={record.id} record={record} />
            ))}
          </div>
        ) : (
          <div className="mt-10 rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-raised)]/80 p-8 text-center">
            <p className="font-semibold">还没有可展示的样例</p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">管理员账号完成视频分析 Project 后，项目样例会公开展示在这里。</p>
            <Link href="/dashboard?tab=analyze" className="mt-5 inline-flex">
              <Button className="rounded-full bg-[#B76442] px-6 hover:bg-[#8F4630]">去分析</Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function SampleCard({ record }: { record: ProjectSample }) {
  const isVideo = record.mediaType === "video";
  const title = record.title || record.mediaName || "Untitled project";
  const description = record.summary || record.prompt || "";
  const durationLabel = record.duration ? formatDuration(record.duration) : null;

  return (
    <Link href={`/samples/${record.id}`} className="group block overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/40">
      <div className="relative aspect-[16/9] overflow-hidden bg-[#E8DED2]">
        {record.mediaUrl ? (
          isVideo ? (
            <video src={record.mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          ) : (
            <img src={record.mediaUrl} alt={title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--color-text-muted)]">
            {isVideo ? <FileVideo className="h-10 w-10" /> : <ImageIcon className="h-10 w-10" />}
          </div>
        )}
        <div className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          {isVideo ? "Video" : "Image"}
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-xl font-semibold leading-tight">{title}</h2>
          <span className="shrink-0 rounded-full bg-[#F1E0D4] px-2 py-1 text-xs font-semibold text-[#8F4630]">{statusLabel(record.status)}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-text-secondary)]">
          <span>{formatDate(record.updatedAt || record.createdAt).split(" ")[0]}</span>
          <span>{record.sceneCount} 个场景</span>
          {durationLabel ? <span>{durationLabel}</span> : null}
        </div>
        {description ? <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{truncate(description, 150)}</p> : null}
        {record.prompt ? <p className="mt-4 line-clamp-2 rounded-lg bg-[var(--color-bg-base)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{truncate(record.prompt, 120)}</p> : null}
      </div>
    </Link>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    analyzing: "分析中",
    ready: "ready",
    failed: "失败",
  };
  return labels[status] || status;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
