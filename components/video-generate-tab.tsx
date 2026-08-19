"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { useTranslations } from "next-intl";

export function VideoGenerateTab({ initialPrompt }: { initialPrompt?: string | null } = {}) {
  const t = useTranslations("videoGenerate");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState("10");
  const [resolution, setResolution] = useState("720p");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referenceImagePreviews, setReferenceImagePreviews] = useState<string[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const MAX_REF_IMAGES = 6;

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 260)}px`;
  };

  const loadRecords = async () => {
    try {
      const res = await fetch("/api/video-generate");
      if (!res.ok) return;
      const data = await res.json();
      setRecords(data.records || []);
    } catch {
      // 历史记录加载失败不影响当前生成流程。
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const pollStatus = async (taskId: string) => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/video-generate/status?taskId=${taskId}`);
        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          throw new Error(errorData?.error || t("queryStatusFailed"));
        }
        const data = await res.json();

        if (data.status === "completed") {
          setVideoUrl(data.videoUrl);
          setStatus(t("generateDone"));
          setIsGenerating(false);
          if (data.record) {
            setRecords((prev) => prev.map((item) => item.taskId === taskId ? data.record : item));
          }
          return true;
        } else if (data.status === "failed") {
          setStatus(t("generateFailed", { error: data.error }));
          setIsGenerating(false);
          if (data.record) {
            setRecords((prev) => prev.map((item) => item.taskId === taskId ? data.record : item));
          }
          return true;
        } else {
          setStatus(`${t("generating")} ${data.progress || ""}`);
          if (data.record) {
            setRecords((prev) => prev.map((item) => item.taskId === taskId ? data.record : item));
          }
          return false;
        }
      } catch (error: any) {
        setStatus(error.message || t("queryStatusFailed"));
        setIsGenerating(false);
        return true;
      }
    };

    const interval = setInterval(async () => {
      const shouldStop = await checkStatus();
      if (shouldStop) {
        clearInterval(interval);
      }
    }, 5000);
    checkStatus().then((shouldStop) => {
      if (shouldStop) clearInterval(interval);
    });
  };

  const resumeRecord = (record: any) => {
    setPrompt(record.prompt || "");
    setVideoUrl(record.videoUrl || null);
    setStatus(record.status === "completed" ? t("generateDone") : `${t("generating")} ${record.progress || ""}`);

    if (record.status === "pending" || record.status === "processing") {
      setIsGenerating(true);
      pollStatus(record.taskId);
    }
  };

  const handleRefImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    addRefImages(files);
  };

  const handleRefImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      addRefImages(files);
    }
  };

  const addRefImages = (files: File[]) => {
    const remainingSlots = MAX_REF_IMAGES - referenceImages.length;
    if (remainingSlots <= 0) return;
    const filesToAdd = files.slice(0, remainingSlots);
    setReferenceImages(prev => [...prev, ...filesToAdd]);
    filesToAdd.forEach(file => {
      setReferenceImagePreviews(prev => [...prev, URL.createObjectURL(file)]);
    });
  };

  const removeRefImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImagePreviews(prev => {
      const newPreviews = prev.filter((_, i) => i !== index);
      prev.forEach((url, i) => { if (i !== index) URL.revokeObjectURL(url); });
      return newPreviews;
    });
    if (refImageInputRef.current) refImageInputRef.current.value = "";
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setStatus(t("creating"));
    setVideoUrl(null);

    try {
      let referenceImageUrls: string[] = [];
      if (referenceImages.length > 0) {
        for (let i = 0; i < referenceImages.length; i++) {
          setStatus(t("uploadingRef", { current: i + 1, total: referenceImages.length }));
          const uploadData = await uploadMediaToBlob(referenceImages[i], (percentage) => {
            setStatus(t("uploadingRefProgress", { current: i + 1, total: referenceImages.length, percent: Math.round(percentage) }));
          });
          referenceImageUrls.push(uploadData.url);
        }
      }

      const res = await fetch("/api/video-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          duration: Number(duration),
          resolution,
          negativePrompt,
          aspectRatio,
          referenceImageUrls,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || t("createFailed"));
      }

      const data = await res.json();
      if (!data.taskId) throw new Error(t("missingTaskId"));
      if (data.record) {
        setRecords((prev) => [data.record, ...prev.filter((item) => item.taskId !== data.record.taskId)]);
      }
      setStatus(t("generating"));

      const taskId = data.taskId;
      pollStatus(taskId);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      setIsGenerating(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <div className="rounded-2xl border border-[var(--color-border-default)]/80 bg-[var(--color-bg-raised)]/70 shadow-[0_18px_45px_rgba(44,24,24,0.04)] backdrop-blur-sm">
            {referenceImagePreviews.length > 0 && (
              <div className="flex flex-wrap gap-3 px-5 pt-4">
                {referenceImagePreviews.map((preview, index) => (
                  <div key={index} className="relative group h-24 w-24 overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] shadow-sm">
                    <img src={preview} alt={t("refImageAlt", { index: index + 1 })} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeRefImage(index); }}
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-bg-raised)]/90 text-[var(--color-text-primary)] shadow-sm transition-colors hover:bg-[var(--color-accent-orange)] hover:text-white"
                      aria-label="Remove reference image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={handlePromptChange}
                placeholder="I want to create a video about..."
                className="min-h-[96px] resize-none overflow-hidden border-0 bg-transparent px-6 py-5 pb-16 text-xl text-[var(--color-text-primary)] shadow-none outline-none placeholder:text-[var(--color-text-muted)] focus-visible:ring-0"
              />
              <span className="absolute right-7 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#D97757]" />
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)]/70 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => referenceImages.length < MAX_REF_IMAGES && refImageInputRef.current?.click()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-base)] hover:text-[var(--color-accent-orange)]"
                  aria-label="Upload reference images"
                >
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l9.193-9.193a3 3 0 114.243 4.243L8.56 18.31a1.5 1.5 0 01-2.122-2.122l8.486-8.486" />
                  </svg>
                </button>
                <label className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--color-border-default)]/70 bg-[var(--color-bg-raised)]/72 px-4 text-base font-medium text-[var(--color-text-primary)] shadow-sm backdrop-blur-sm">
                  <svg className="h-5 w-5 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.75L12 3l6 3.75M6 6.75l6 3.75 6-3.75M6 6.75v6.75l6 3.75m6-10.5v6.75l-6 3.75m0-6.75v6.75" />
                  </svg>
                  Duration:
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="bg-transparent text-[var(--color-text-primary)] outline-none"
                  >
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                    <option value="15">15s</option>
                  </select>
                </label>
                <label className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--color-border-default)]/70 bg-[var(--color-bg-raised)]/72 px-4 text-base font-medium text-[var(--color-text-primary)] shadow-sm backdrop-blur-sm">
                  <svg className="h-5 w-5 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 17h16M7 4v16M17 4v16" />
                  </svg>
                  Ratio:
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="bg-transparent text-[var(--color-text-primary)] outline-none"
                  >
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="3:4">3:4</option>
                    <option value="4:3">4:3</option>
                  </select>
                </label>
                <label className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--color-border-default)]/70 bg-[var(--color-bg-raised)]/72 px-4 text-base font-medium text-[var(--color-text-primary)] shadow-sm backdrop-blur-sm">
                  Resolution:
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    className="bg-transparent text-[var(--color-text-primary)] outline-none"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </label>
              </div>
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className="h-12 w-12 rounded-xl bg-[var(--color-bg-raised)]/45 p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-accent-orange)] hover:text-white disabled:hover:bg-[var(--color-bg-raised)]/45 disabled:hover:text-[var(--color-text-muted)]"
                aria-label={t("start")}
              >
                {isGenerating ? (
                  <Spinner size="sm" />
                ) : (
                  <svg className="h-6 w-6 -rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.876L6 12zm0 0h7.5" />
                  </svg>
                )}
              </Button>
            </div>

            <input
              ref={refImageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleRefImageSelect}
              className="hidden"
            />
          </div>
        </div>

        <div className="space-y-6">
          {status && (
            <div className="text-center text-sm text-[var(--color-text-secondary)]">{status}</div>
          )}

          {videoUrl ? (
            <Card className="border-[var(--color-border-default)] bg-[var(--color-bg-raised)] shadow-sm">
              <CardHeader>
                <CardTitle className="text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>{t("preview")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <video src={videoUrl} controls className="w-full rounded-xl" />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => window.open(videoUrl, "_blank")} className="flex-1 border-[var(--color-border-default)]">
                    {t("download")}
                  </Button>
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(prompt)} className="flex-1 border-[var(--color-border-default)]">
                    {t("copyPrompt")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-[var(--color-border-default)] bg-[var(--color-bg-raised)] shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-base)] text-[var(--color-text-muted)] flex items-center justify-center mb-4">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-[var(--color-text-primary)] font-medium mb-1">Generated video will appear here</p>
                <p className="text-sm text-[var(--color-text-muted)]">Enter a prompt on the left and click the send button to start.</p>
              </CardContent>
            </Card>
          )}

          {records.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-5 text-[var(--color-text-muted)]">
                <span className="h-px flex-1 bg-[var(--color-border-default)]" />
                <span className="text-sm font-semibold">{t("recent")}</span>
                <span className="h-px flex-1 bg-[var(--color-border-default)]" />
              </div>
              <div className="grid gap-3">
                {records.slice(0, 4).map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => resumeRecord(record)}
                    className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)]/75 px-4 py-3 text-left transition-colors hover:border-[var(--color-accent-orange)]/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{record.prompt}</span>
                      <span className="text-xs text-[var(--color-text-secondary)]">{record.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {negativePrompt && (
        <input
          type="hidden"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
        />
      )}
    </div>
  );
}


