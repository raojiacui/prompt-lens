"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface VideoGenerateTabProps {
  sharedPrompt?: string;
  onClearPrompt?: () => void;
}

export function VideoGenerateTab({ sharedPrompt = "", onClearPrompt }: VideoGenerateTabProps) {
  const [prompt, setPrompt] = useState(sharedPrompt);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  // 当 sharedPrompt 变化时更新
  useEffect(() => {
    if (sharedPrompt) {
      setPrompt(sharedPrompt);
    }
  }, [sharedPrompt]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setStatus("processing");
    setErrorMessage(null);
    setVideoUrl(null);

    try {
      // 发送生成请求
      const response = await fetch("/api/video-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: "sora-2-text-to-video",
          prompt: prompt.trim(),
          aspectRatio: "landscape",
          nFrames: "10",
          size: "Standard",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start generation");
      }

      const data = await response.json();
      setTaskId(data.taskId);

      // 轮询状态
      await pollStatus(data.taskId);
    } catch (error: any) {
      setStatus("error");
      setErrorMessage(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const pollStatus = async (taskId: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const response = await fetch(
          `/api/video-generate/status?taskId=${taskId}&type=video`
        );

        if (!response.ok) {
          throw new Error("Failed to get status");
        }

        const data = await response.json();

        if (data.status === "success") {
          setStatus("done");
          setVideoUrl(data.resultUrl || data.url);
          return;
        }

        if (data.status === "failed") {
          throw new Error(data.error || "Generation failed");
        }

        attempts++;
      } catch (error: any) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }
    }

    setStatus("error");
    setErrorMessage("Generation timeout");
  };

  const handleClear = () => {
    setPrompt("");
    setVideoUrl(null);
    setStatus("idle");
    setErrorMessage(null);
    setTaskId(null);
    onClearPrompt?.();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左侧：输入区 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
        <CardHeader>
          <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="w-10 h-10 rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </span>
            AI 视频生成
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sharedPrompt && (
            <div className="bg-[#D97757]/10 border border-[#D97757]/30 rounded-lg px-3 py-2">
              <p className="text-xs text-[#D97757] mb-1">已从分析结果填充提示词</p>
              <Button
                variant="outline"
                size="sm"
                onClick={onClearPrompt}
                className="h-auto py-1 px-2 text-xs border-[#D97757]/50 text-[#D97757] hover:bg-[#D97757]/10"
              >
                清除
              </Button>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-[#141413] block mb-2">视频提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的视频场景..."
              rows={8}
              className="bg-white border-[#C8C4BC] focus:border-[#D97757] resize-none"
            />
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              className="flex-1 h-11 bg-[#D97757] hover:bg-[#C96848] text-white rounded-xl font-medium shadow-sm hover:shadow-md transition-all"
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" className="border-white" />
                  生成中...
                </span>
              ) : (
                "生成视频"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleClear}
              className="h-11 border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757] rounded-xl"
            >
              清空
            </Button>
          </div>

          {status === "processing" && (
            <div className="bg-[#ECE9E0] rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Spinner size="sm" className="border-[#D97757]" />
                <div>
                  <p className="text-sm font-medium text-[#141413]">正在生成视频</p>
                  <p className="text-xs text-[#6B6860]">预计需要 1-3 分钟，请耐心等待...</p>
                </div>
              </div>
            </div>
          )}

          {status === "error" && errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600">{errorMessage}</p>
            </div>
          )}

          <div className="border-t border-[#D8D5CC] pt-4">
            <h3 className="text-sm font-medium text-[#141413] mb-2">提示词技巧</h3>
            <ul className="text-xs text-[#6B6860] space-y-1">
              <li>• 描述具体场景、人物、动作</li>
              <li>• 说明光线、氛围、风格</li>
              <li>• 越详细的描述效果越好</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* 右侧：预览区 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
        <CardHeader>
          <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="w-10 h-10 rounded-xl bg-[#D8D5CC]/30 flex items-center justify-center text-[#6B6860]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </span>
            预览
          </CardTitle>
        </CardHeader>
        <CardContent>
          {videoUrl ? (
            <div className="space-y-4">
              <video
                src={videoUrl}
                controls
                className="w-full rounded-lg shadow-md"
              />
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[#D97757] hover:underline flex items-center gap-1"
              >
                下载视频 ↗
              </a>
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#D8D5CC]/30 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#9C9890]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
              <p className="text-[#6B6860] text-sm">
                {status === "processing" ? "视频生成中..." : "输入提示词并点击生成"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
