"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { useTranslations } from "next-intl";

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

interface VideoSegment {
  start: number;
  end: number;
  summary: string;
  tags: string[];
}

type Tab = "analyze" | "history" | "settings" | "audio" | "edit" | "video-gen" | "stats";

interface AudioAnalyzeTabProps {
  activeTab: Tab;
}

export function AudioAnalyzeTab({ activeTab }: AudioAnalyzeTabProps) {
  const t = useTranslations("audioAnalyze");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{
    id: string;
    language: string;
    transcription: TranscriptionSegment[];
    segments: VideoSegment[];
    duration: number;
  } | null>(null);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [whisperModel, setWhisperModel] = useState("assemblyai");
  const [llmProvider, setLlmProvider] = useState("deepseek");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [funasrUrl, setFunasrUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setClipUrl(null);
    setSelectedSegments([]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) {
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
      setResult(null);
      setClipUrl(null);
      setSelectedSegments([]);
    }
  };

  const handleAnalyze = async () => {
    let url = "";

    if (inputMode === "file") {
      if (!selectedFile) return;
      setIsLoading(true);
      setProgress(t("uploading"));

      try {
        const uploadData = await uploadMediaToBlob(selectedFile, (percentage) => {
          setProgress(t("uploadingProgress", { percent: Math.round(percentage) }));
        });

        console.log("Upload response:", uploadData);
        url = uploadData.url;
        if (!url) {
          console.error("Upload returned empty URL, response:", uploadData);
          throw new Error(t("uploadEmptyUrl", { response: JSON.stringify(uploadData) }));
        }
      } catch (error: any) {
        alert(t("uploadFailed", { message: error.message }));
        setIsLoading(false);
        return;
      }
    } else {
      if (!videoUrlInput.trim()) {
        alert(t("urlRequired"));
        return;
      }
      setIsLoading(true);
      setProgress(t("downloading"));
      url = videoUrlInput.trim();
    }

    setVideoUrl(url);

    try {
      setProgress(t("extracting"));

      let analyzeRes;
      try {
        analyzeRes = await fetch("/api/audio-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaUrl: url,
            whisperModelSize: whisperModel,
            llmProvider,
            prompt: customPrompt || undefined,
            funasrUrl: whisperModel === "funasr" ? funasrUrl : undefined,
          }),
        });
      } catch (fetchError: any) {
        console.error("Network fetch error:", fetchError);
        throw new Error(t("networkError", { message: fetchError.message }));
      }

      if (!analyzeRes.ok) {
        let errMsg = `Server error: ${analyzeRes.status}`;
        try {
          const err = await analyzeRes.json();
          errMsg = err.error || errMsg;
        } catch (e) {
          // 响应不是 JSON
        }
        throw new Error(errMsg);
      }

      const data = await analyzeRes.json();
      setResult(data);
      setSelectedSegments(data.segments.map((_: any, i: number) => i));
    } catch (error: any) {
      console.error("Audio analysis error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress("");
    }
  };

  const handleClip = async () => {
    if (!result || selectedSegments.length === 0) return;
    setClipLoading(true);

    try {
      const segments = selectedSegments.map((i) => result.segments[i]);

      const clipRes = await fetch("/api/audio-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: videoUrl,
          segments,
          outputFormat: "merge",
        }),
      });

      if (!clipRes.ok) {
        const err = await clipRes.json();
        throw new Error(err.error || "Clip failed");
      }

      const data = await clipRes.json();
      setClipUrl(data.clipUrl);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setClipLoading(false);
    }
  };

  const toggleSegment = (index: number) => {
    setSelectedSegments((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const resetUpload = () => {
    setSelectedFile(null);
    setPreview(null);
    setVideoUrl("");
    setVideoUrlInput("");
    setResult(null);
    setClipUrl(null);
    setSelectedSegments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (activeTab !== "audio") return null;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧：上传区域 */}
        <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="w-10 h-10 rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </span>
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 输入方式切换 */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => { setInputMode("file"); resetUpload(); }}
                className={`px-4 py-2 text-sm rounded-lg transition-all ${
                  inputMode === "file"
                    ? "bg-[#D97757] text-white"
                    : "bg-[#ECE9E0] text-[#6B6860] hover:bg-[#D8D5CC]"
                }`}
              >
                {t("uploadFile")}
              </button>
              <button
                onClick={() => { setInputMode("url"); resetUpload(); }}
                className={`px-4 py-2 text-sm rounded-lg transition-all ${
                  inputMode === "url"
                    ? "bg-[#D97757] text-white"
                    : "bg-[#ECE9E0] text-[#6B6860] hover:bg-[#D8D5CC]"
                }`}
              >
                {t("inputUrl")}
              </button>
            </div>

            {/* URL 输入模式 */}
            {inputMode === "url" && (
              <div className="space-y-2">
                <Input
                  type="url"
                  value={videoUrlInput}
                  onChange={(e) => setVideoUrlInput(e.target.value)}
                  placeholder={t("urlPlaceholder")}
                  className="bg-white border-[#C8C4BC] focus:border-[#D97757]"
                />
                <p className="text-xs text-[#6B6860]">{t("urlHint")}</p>
              </div>
            )}

            {/* 拖拽上传 */}
            {inputMode === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300",
                isDragging ? "border-[#D97757] bg-[#D97757]/5" : "border-[#C8C4BC] hover:border-[#D97757]/50",
                preview && "border-transparent bg-[#ECE9E0]"
              )}
            >
              {preview ? (
                <div className="relative">
                  <video src={preview} className="max-h-48 rounded-lg shadow-md" controls />
                  <button
                    onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-[#D97757] text-white rounded-full flex items-center justify-center shadow-md hover:bg-[#C96848]"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#D97757]/10 flex items-center justify-center">
                    <svg className="w-7 h-7 text-[#D97757]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <p className="text-[#141413] font-medium mb-1">{t("dropHere")}</p>
                  <p className="text-sm text-[#6B6860]">{t("dropHint")}</p>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />
            </div>
            )}

            {selectedFile && (
              <div className="flex items-center justify-between bg-[#ECE9E0] rounded-lg px-4 py-2">
                <span className="text-sm text-[#6B6860] truncate">{selectedFile.name}</span>
                <span className="text-xs text-[#D97757] bg-[#D97757]/10 px-2 py-1 rounded">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            )}

            {/* 设置选项 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("engine")}</label>
                <select
                  value={whisperModel}
                  onChange={(e) => setWhisperModel(e.target.value)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="assemblyai">{t("engineAssemblyai")}</option>
                  <option value="funasr">{t("engineFunasr")}</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("llmProvider")}</label>
                <select
                  value={llmProvider}
                  onChange={(e) => setLlmProvider(e.target.value)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="deepseek">{t("llmDeepseek")}</option>
                  <option value="zhipu">{t("llmZhipu")}</option>
                </select>
              </div>
            </div>

            {/* FunASR 自托管地址 */}
            {whisperModel === "funasr" && (
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">{t("funasrUrl")}</label>
                <Input
                  type="url"
                  value={funasrUrl}
                  onChange={(e) => setFunasrUrl(e.target.value)}
                  placeholder={t("funasrUrlPlaceholder")}
                  className="bg-white border-[#C8C4BC] focus:border-[#D97757]"
                />
                <p className="text-xs text-[#9C9890] mt-1">{t("funasrUrlHint")}</p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-[#141413] block mb-2">{t("customPrompt")}</label>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={t("customPromptPlaceholder")}
                className="bg-white border-[#C8C4BC] focus:border-[#D97757]"
                rows={2}
              />
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={
                (inputMode === "file" && !selectedFile) ||
                (inputMode === "url" && !videoUrlInput.trim()) ||
                (whisperModel === "funasr" && !funasrUrl.trim()) ||
                isLoading
              }
              className="w-full h-11 bg-[#D97757] hover:bg-[#C96848] text-white rounded-xl font-medium shadow-sm hover:shadow-md transition-all"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" className="border-white" />
                  {progress || t("processing")}
                </span>
              ) : (
                t("start")
              )}
            </Button>
          </CardContent>
        </Card>

        {/* 右侧：结果区域 */}
        <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="w-10 h-10 rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>
              {t("result")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-4">
                {/* 基本信息 */}
                <div className="flex items-center gap-4 text-sm text-[#6B6860] bg-[#ECE9E0] rounded-lg px-3 py-2">
                  <span>{t("language")}: {result.language}</span>
                  <span>{t("duration")}: {formatTime(result.duration)}</span>
                  <span>{t("segments")}: {t("segmentsCount", { count: result.segments.length })}</span>
                </div>

                {/* 片段列表 */}
                <div className="max-h-[350px] overflow-y-auto space-y-2">
                  <p className="text-sm font-medium text-[#141413] mb-2" style={{ fontFamily: 'var(--font-heading)' }}>{t("selectSegments")}</p>
                  {result.segments.map((seg, i) => (
                    <div
                      key={i}
                      onClick={() => toggleSegment(i)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all",
                        selectedSegments.includes(i)
                          ? "bg-[#D97757]/10 border border-[#D97757]/30"
                          : "bg-[#ECE9E0] hover:bg-[#D8D5CC]"
                      )}
                    >
                      <Checkbox
                        checked={selectedSegments.includes(i)}
                        onChange={() => toggleSegment(i)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-[#D97757] bg-[#D97757]/10 px-2 py-0.5 rounded">
                            {formatTime(seg.start)} - {formatTime(seg.end)}
                          </span>
                          {seg.tags.slice(0, 2).map((tag, j) => (
                            <span key={j} className="text-xs text-[#6B6860]">#{tag}</span>
                          ))}
                        </div>
                        <p className="text-sm text-[#141413] line-clamp-2">{seg.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 剪辑按钮 */}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={handleClip}
                    disabled={selectedSegments.length === 0 || clipLoading}
                    className="flex-1 h-10 bg-[#D97757] hover:bg-[#C96848] text-white rounded-xl font-medium shadow-sm hover:shadow-md transition-all"
                  >
                    {clipLoading ? (
                      <span className="flex items-center gap-2">
                        <Spinner size="sm" className="border-white" />
                        {t("clipping")}
                      </span>
                    ) : (
                      t("clipSelected", { count: selectedSegments.length })
                    )}
                  </Button>
                </div>

                {/* 剪辑结果 */}
                {clipUrl && (
                  <div className="mt-4 p-4 bg-[#D97757]/10 rounded-xl">
                    <p className="text-sm font-medium text-[#D97757] mb-2">{t("clipDone")}</p>
                    <video src={clipUrl} className="w-full rounded-lg" controls />
                    <a
                      href={clipUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mt-2 text-sm text-[#D97757] hover:underline"
                    >
                      {t("downloadVideo")}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#D8D5CC]/30 flex items-center justify-center">
                  <svg className="w-8 h-8 text-[#9C9890]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <p className="text-[#6B6860]">{t("emptyHint")}</p>
                <p className="text-sm text-[#9C9890] mt-1">{t("emptySubHint")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 文字稿区域 */}
      {result && (
        <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#141413] text-sm" style={{ fontFamily: 'var(--font-display)' }}>{t("transcript")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto bg-[#ECE9E0] rounded-lg p-4">
              {result.transcription.map((seg, i) => (
                <span key={i} className="text-sm text-[#141413]">
                  <span className="text-xs text-[#D97757] mr-2">[{formatTime(seg.start)}]</span>
                  {seg.text}{" "}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
