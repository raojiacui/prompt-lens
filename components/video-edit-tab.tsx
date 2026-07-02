"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { useTranslations } from "next-intl";

export function VideoEditTab() {
  const t = useTranslations("videoEdit");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [ffmpegServiceUrl, setFfmpegServiceUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const examplePrompts = [t("example1"), t("example2"), t("example3")];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError(t("fileRequired"));
      return;
    }
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setResult(null);
    setError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) {
      handleFile(file);
    }
  };

  const resetUpload = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setVideoUrl("");
    setVideoUrlInput("");
    setResult(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleEdit = async () => {
    setError("");
    setResult(null);

    let finalVideoUrl = "";

    if (inputMode === "file") {
      if (!videoFile) {
        setError(t("fileRequired"));
        return;
      }
      setIsLoading(true);
      setProgress(t("uploading"));
      try {
        const uploadData = await uploadMediaToBlob(videoFile, (percentage) => {
          setProgress(t("uploadingProgress", { percent: Math.round(percentage) }));
        });
        finalVideoUrl = uploadData.url;
      } catch (err: any) {
        setError(err.message);
        setIsLoading(false);
        setProgress("");
        return;
      }
    } else {
      if (!videoUrlInput.trim()) {
        setError(t("urlRequired"));
        return;
      }
      finalVideoUrl = videoUrlInput.trim();
      setIsLoading(true);
    }

    if (!ffmpegServiceUrl.trim()) {
      setError(t("ffmpegUrlRequired"));
      setIsLoading(false);
      setProgress("");
      return;
    }
    if (!prompt.trim()) {
      setError(t("inputRequired"));
      setIsLoading(false);
      setProgress("");
      return;
    }

    setVideoUrl(finalVideoUrl);

    try {
      setProgress(t("processing"));

      const response = await fetch("/api/video-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: finalVideoUrl,
          prompt,
          ffmpegServiceUrl: ffmpegServiceUrl.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("editFailed"));
      }

      setResult(data);
      setProgress(t("done"));
    } catch (err: any) {
      setError(err.message);
      setProgress("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-medium text-[#141413]" style={{ fontFamily: 'var(--font-display)' }}>{t("title")}</h2>
        <p className="text-[#6B6860] mt-1">{t("subtitle")}</p>
      </div>

      {/* 示例提示词 */}
      <div className="flex flex-wrap gap-2">
        {examplePrompts.map((example, i) => (
          <button
            key={i}
            onClick={() => setPrompt(example)}
            className="text-xs px-3 py-1.5 rounded-full bg-[#D97757]/10 text-[#D97757] hover:bg-[#D97757]/20 transition-colors"
          >
            {example}
          </button>
        ))}
      </div>

      {/* 输入区域 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
        <CardContent className="pt-6 space-y-4">
          {/* 输入方式切换 */}
          <div className="flex gap-2">
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

          {/* 视频上传区域 */}
          {inputMode === "file" && (
          <div
            className={cn(
              "relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer",
              isDragging
                ? "border-[#D97757] bg-[#D97757]/5"
                : "border-[#C8C4BC] hover:border-[#D97757]",
              videoPreview && "p-4"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {videoPreview ? (
              <div className="relative">
                <video
                  src={videoPreview}
                  controls
                  className="max-h-[300px] mx-auto rounded-lg shadow-md"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                  className="absolute -top-2 -right-2 w-7 h-7 bg-[#D97757] text-white rounded-full flex items-center justify-center shadow-md hover:bg-[#C96848]"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="py-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#D97757]/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-[#D97757]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-[#141413] font-medium">
                  {t("dropHere")}
                </p>
                <p className="text-sm text-[#6B6860] mt-1">
                  {t("dropHint")}
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
          )}

          {/* 自托管 FFmpeg 服务地址 */}
          <div>
            <label className="text-sm font-medium text-[#141413] block mb-2">
              {t("ffmpegUrl")}
            </label>
            <Input
              type="url"
              value={ffmpegServiceUrl}
              onChange={(e) => setFfmpegServiceUrl(e.target.value)}
              placeholder={t("ffmpegUrlPlaceholder")}
              className="bg-white border-[#C8C4BC] focus:border-[#D97757]"
            />
            <p className="text-xs text-[#9C9890] mt-1">{t("ffmpegUrlHint")}</p>
          </div>

          {/* 剪辑描述 */}
          <div>
            <label className="text-sm font-medium text-[#141413] block mb-2">
              {t("editDesc")}
            </label>
            <Textarea
              className="bg-white border-[#C8C4BC] focus:border-[#D97757] min-h-[100px]"
              placeholder={t("editPlaceholder")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="p-3 rounded-lg bg-[#C0453A]/10 text-[#C0453A] text-sm">
              {error}
            </div>
          )}

          {/* 进度 */}
          {progress && (
            <div className="flex items-center gap-2 text-[#D97757]">
              <Spinner size="sm" />
              <span>{progress}</span>
            </div>
          )}

          {/* 提交按钮 */}
          <Button
            onClick={handleEdit}
            disabled={isLoading || !prompt.trim() || !ffmpegServiceUrl.trim() || (inputMode === "file" ? !videoFile : !videoUrlInput.trim())}
            className="w-full bg-[#D97757] hover:bg-[#C96848] shadow-sm hover:shadow-md transition-all"
          >
            {isLoading ? t("processing") : t("start")}
          </Button>
        </CardContent>
      </Card>

      {/* 结果展示 */}
      {result && result.outputUrl && (
        <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
          <CardHeader>
            <CardTitle style={{ fontFamily: 'var(--font-display)' }}>{t("result")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 视频预览 */}
            <video
              src={result.outputUrl}
              controls
              className="w-full rounded-lg shadow-md"
            />

            {/* 下载按钮 */}
            <div className="flex gap-3">
              <a href={result.outputUrl} download className="flex-1">
                <Button className="w-full bg-[#D97757] hover:bg-[#C96848]">
                  {t("download")}
                </Button>
              </a>
            </div>

            {/* AI 解析的指令 */}
            {result.instruction && (
              <div className="p-4 rounded-xl bg-[#ECE9E0]">
                <h4 className="font-medium text-[#141413] mb-2" style={{ fontFamily: 'var(--font-heading)' }}>{t("instruction")}</h4>
                <pre className="text-xs text-[#6B6860] overflow-auto font-mono">
                  {JSON.stringify(result.instruction, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 功能说明 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
        <CardHeader>
          <CardTitle className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>{t("features")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <h4 className="font-medium text-[#141413] mb-1" style={{ fontFamily: 'var(--font-heading)' }}>{t("feat1Title")}</h4>
              <p className="text-[#6B6860]">{t("feat1Desc")}</p>
            </div>
            <div>
              <h4 className="font-medium text-[#141413] mb-1" style={{ fontFamily: 'var(--font-heading)' }}>{t("feat2Title")}</h4>
              <p className="text-[#6B6860]">{t("feat2Desc")}</p>
            </div>
            <div>
              <h4 className="font-medium text-[#141413] mb-1" style={{ fontFamily: 'var(--font-heading)' }}>{t("feat3Title")}</h4>
              <p className="text-[#6B6860]">{t("feat3Desc")}</p>
            </div>
            <div>
              <h4 className="font-medium text-[#141413] mb-1" style={{ fontFamily: 'var(--font-heading)' }}>{t("feat4Title")}</h4>
              <p className="text-[#6B6860]">{t("feat4Desc")}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
