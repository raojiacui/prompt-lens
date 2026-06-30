"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export function VideoEditTab() {
  const t = useTranslations("videoEdit");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [isDragging, setIsDragging] = useState(false);
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

  const handleEdit = async () => {
    if (!videoFile || !prompt) {
      setError(t("inputRequired"));
      return;
    }

    setIsLoading(true);
    setError("");
    setResult(null);
    setProgress(t("uploading"));

    try {
      const formData = new FormData();
      formData.append("file", videoFile);
      formData.append("prompt", prompt);

      const response = await fetch("/api/video-edit", {
        method: "POST",
        body: formData,
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
          {/* 视频上传区域 */}
          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer",
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
              <video
                src={videoPreview}
                controls
                className="max-h-[300px] mx-auto rounded-lg shadow-md"
              />
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
            disabled={isLoading || !videoFile || !prompt}
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
