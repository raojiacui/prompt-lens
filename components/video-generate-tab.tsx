"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { useTranslations } from "next-intl";

export function VideoGenerateTab() {
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
    <div className="animate-fade-in space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧：输入区域 */}
        <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="w-10 h-10 rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </span>
              {t("inputPrompt")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("promptPlaceholder")}
              className="min-h-[180px] border-[#D8D5CC] focus:border-[#D97757]"
            />

            {/* 多张参考图上传 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-[#141413]">{t("refImages")}</label>
                <span className="text-xs text-[#9C9890]">{referenceImages.length}/{MAX_REF_IMAGES}</span>
              </div>
              <div
                onClick={() => referenceImages.length < MAX_REF_IMAGES && refImageInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleRefImageDrop}
                className={cn(
                  "border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all min-h-[100px]",
                  isDragging ? "border-[#D97757] bg-[#D97757]/5" : "border-[#C8C4BC] hover:border-[#D97757]/50",
                  referenceImages.length >= MAX_REF_IMAGES && "opacity-50 cursor-not-allowed"
                )}
              >
                {referenceImagePreviews.length > 0 ? (
                  <div className="flex flex-wrap gap-3 justify-center">
                    {referenceImagePreviews.map((preview, index) => (
                      <div key={index} className="relative group">
                        <img src={preview} alt={t("refImageAlt", { index: index + 1 })} className="w-20 h-20 object-cover rounded-lg shadow-md" />
                        <button
                          onClick={(e) => { e.stopPropagation(); removeRefImage(index); }}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-[#D97757] text-white rounded-full flex items-center justify-center shadow-md hover:bg-[#C96848] transition-colors text-sm opacity-0 group-hover:opacity-100"
                        >
                          ×
                        </button>
                        <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1 rounded">{index + 1}</span>
                      </div>
                    ))}
                    {referenceImages.length < MAX_REF_IMAGES && (
                      <div className="w-20 h-20 border-2 border-dashed border-[#C8C4BC] rounded-lg flex items-center justify-center text-[#9C9890]">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-[#D97757]/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-[#D97757]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#6B6860]">{t("refDropHere")}</p>
                    <p className="text-xs text-[#9C9890]">{t("refDropHint", { max: MAX_REF_IMAGES })}</p>
                  </>
                )}
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

            {/* 设置选项 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("duration")}</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="5">{t("duration5")}</option>
                  <option value="10">{t("duration10")}</option>
                  <option value="15">{t("duration15")}</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("resolution")}</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("aspectRatio")}</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="16:9">{t("ratio169")}</option>
                  <option value="9:16">{t("ratio916")}</option>
                  <option value="1:1">{t("ratio11")}</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("negativePrompt")}</label>
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder={t("negativePlaceholder")}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413] text-sm"
                />
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              className="w-full bg-[#D97757] hover:bg-[#C96848] text-white"
            >
              {isGenerating ? (
                <>
                  <Spinner size="sm" className="border-white mr-2" />
                  {status}
                </>
              ) : (
                t("start")
              )}
            </Button>

            {status && (
              <div className="text-center text-sm text-[#6B6860]">{status}</div>
            )}

            {records.length > 0 && (
              <div className="border-t border-[#D8D5CC] pt-4 space-y-2">
                <div className="text-sm font-medium text-[#141413]">{t("recent")}</div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {records.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => resumeRecord(record)}
                      className="w-full text-left bg-white border border-[#D8D5CC] rounded-lg px-3 py-2 hover:border-[#D97757]/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-[#141413] truncate">{record.prompt}</span>
                        <span className="text-xs text-[#6B6860] whitespace-nowrap">{record.status}</span>
                      </div>
                      {record.videoUrl && (
                        <div className="text-xs text-[#D97757] mt-1">{t("recentGenerated")}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 右侧：视频预览 */}
        <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="w-10 h-10 rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </span>
              {t("preview")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {videoUrl ? (
              <div>
                <video
                  src={videoUrl}
                  controls
                  className="w-full rounded-lg"
                />
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open(videoUrl, "_blank")}
                    className="flex-1 border-[#D8D5CC]"
                  >
                    {t("download")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(prompt)}
                    className="flex-1 border-[#D8D5CC]"
                  >
                    {t("copyPrompt")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[180px] text-[#9C9890]">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 text-[#D8D5CC]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p>{t("emptyHint")}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
