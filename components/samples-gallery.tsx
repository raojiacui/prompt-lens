"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatDate, truncate } from "@/lib/utils";
import { ArrowLeft, FileVideo, Image as ImageIcon, Search } from "lucide-react";

type SampleRecord = {
  id: string;
  mediaType: "video" | "image" | string;
  mediaName: string | null;
  mediaUrl: string | null;
  corePrompt: string | null;
  prompt: string | null;
  favorite: boolean | null;
  createdAt: string;
};

type Filter = "all" | "video" | "image";

export function SamplesGallery() {
  const [records, setRecords] = useState<SampleRecord[]>([]);
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
      return [record.mediaName, record.corePrompt, record.prompt]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [filter, records, search]);

  const videoCount = records.filter((record) => record.mediaType === "video").length;
  const imageCount = records.filter((record) => record.mediaType === "image").length;

  return (
    <main className="min-h-screen bg-[#EEF3FA] px-5 pb-16 pt-24 text-[#1F252E] md:px-10 lg:px-14">
      <div className="mx-auto max-w-[1720px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-normal md:text-5xl">样例</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#647080]">
              这里展示站点精选的视频分析样例，访客可以直接浏览素材效果、分析摘要和可复用提示词方向。
            </p>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold text-[#1476F2] transition-colors hover:text-[#0F56B3]">
            <ArrowLeft className="h-5 w-5" />
            返回
          </Link>
        </div>

        <section className="mt-8 flex flex-col gap-4 rounded-2xl border border-white/70 bg-white/65 p-4 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
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
                  filter === item.key ? "bg-[#1476F2] text-white shadow-sm" : "bg-white text-[#647080] hover:text-[#1F252E]"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-full border border-[#D9E0EA] bg-white px-4 text-[#647080] shadow-sm md:w-[360px]">
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索文件名或提示词"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#1F252E] outline-none placeholder:text-[#94A0AE]"
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
          <div className="mt-10 rounded-2xl border border-dashed border-[#C8D3E2] bg-white/70 p-8 text-center">
            <p className="font-semibold">还没有可展示的样例</p>
            <p className="mt-2 text-sm text-[#647080]">管理员账号完成视频分析后，历史样例会公开展示在这里。</p>
            <Link href="/dashboard?tab=analyze" className="mt-5 inline-flex">
              <Button className="rounded-full bg-[#1476F2] px-6 hover:bg-[#0F56B3]">去分析</Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function SampleCard({ record }: { record: SampleRecord }) {
  const isVideo = record.mediaType === "video";
  const title = record.mediaName || "Untitled sample";
  const description = record.corePrompt || record.prompt || "";

  return (
    <article className="group overflow-hidden rounded-2xl border border-[#D9E0EA] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="relative aspect-[16/9] overflow-hidden bg-[#DDE6F1]">
        {record.mediaUrl ? (
          isVideo ? (
            <video src={record.mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          ) : (
            <img src={record.mediaUrl} alt={title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[#8B98A8]">
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
          {record.favorite ? <span className="rounded-full bg-[#FFE7C2] px-2 py-1 text-xs font-semibold text-[#9A5A00]">收藏</span> : null}
        </div>
        <p className="mt-3 text-base text-[#7A8492]">{formatDate(record.createdAt).split(" ")[0]}</p>
        {description ? <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-[#647080]">{truncate(description, 150)}</p> : null}
      </div>
    </article>
  );
}
