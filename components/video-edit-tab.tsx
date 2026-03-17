"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function VideoEditTab() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const examplePrompts = [
    "把前5秒和10-20秒拼接，加上淡入淡出转场，配欢快的音乐",
    "保留0-15秒，调成电影色调",
    "把5-10秒和15-25秒拼接，加溶解转场",
  ];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("请选择视频文件");
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
      setError("请选择视频文件并输入剪辑描述");
      return;
    }

    setIsLoading(true);
    setError("");
    setResult(null);
    setProgress("正在上传视频...");

    try {
      // 使用 FormData 上传视频
      const formData = new FormData();
      formData.append("file", videoFile);
      formData.append("prompt", prompt);

      const response = await fetch("/api/video-edit", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "剪辑失败");
      }

      setResult(data);
      setProgress("剪辑完成！");
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
        <h2 className="text-2xl font-bold text-[#3D3D3D]">AI 视频剪辑</h2>
        <p className="text-[#6B6B6B]">输入一句描述，AI 自动帮你剪辑视频</p>
      </div>

      {/* 示例提示词 */}
      <div className="flex flex-wrap gap-2">
        {examplePrompts.map((example, i) => (
          <button
            key={i}
            onClick={() => setPrompt(example)}
            className="text-xs px-3 py-1 rounded-full bg-[#7C9A92]/10 text-[#7C9A92] hover:bg-[#7C9A92]/20 transition-colors"
          >
            {example}
          </button>
        ))}
      </div>

      {/* 输入区域 */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* 视频上传区域 */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
              isDragging
                ? "border-[#7C9A92] bg-[#7C9A92]/5"
                : "border-[#B8C5D6] hover:border-[#7C9A92]",
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
                className="max-h-[300px] mx-auto rounded-lg"
              />
            ) : (
              <div className="py-8">
                <div className="text-4xl mb-3">🎬</div>
                <p className="text-[#3D3D3D] font-medium">
                  点击或拖拽上传视频
                </p>
                <p className="text-sm text-[#6B6B6B] mt-1">
                  支持 MP4, MOV, AVI 等格式
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
            <label className="text-sm font-medium text-[#3D3D3D] block mb-2">
              剪辑描述
            </label>
            <textarea
              className="w-full min-h-[100px] px-3 py-2 rounded-lg border border-[#B8C5D6] focus:outline-none focus:ring-2 focus:ring-[#7C9A92] focus:border-transparent resize-none"
              placeholder="描述你的剪辑需求，如：把前5秒和10-20秒拼接，加上淡入淡出转场，配欢快的音乐"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* 进度 */}
          {progress && (
            <div className="flex items-center gap-2 text-[#7C9A92]">
              <Spinner size="sm" />
              <span>{progress}</span>
            </div>
          )}

          {/* 提交按钮 */}
          <Button
            onClick={handleEdit}
            disabled={isLoading || !videoFile || !prompt}
            className="w-full bg-[#7C9A92] hover:bg-[#6B8A82]"
          >
            {isLoading ? "处理中..." : "开始剪辑"}
          </Button>
        </CardContent>
      </Card>

      {/* 结果展示 */}
      {result && result.outputUrl && (
        <Card>
          <CardHeader>
            <CardTitle>剪辑结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 视频预览 */}
            <video
              src={result.outputUrl}
              controls
              className="w-full rounded-lg"
            />

            {/* 下载按钮 */}
            <div className="flex gap-3">
              <a href={result.outputUrl} download className="flex-1">
                <Button className="w-full bg-[#7C9A92] hover:bg-[#6B8A82]">
                  下载视频
                </Button>
              </a>
            </div>

            {/* AI 解析的指令 */}
            {result.instruction && (
              <div className="p-4 rounded-lg bg-[#F7F6F3]">
                <h4 className="font-medium text-[#3D3D3D] mb-2">AI 解析的剪辑指令：</h4>
                <pre className="text-xs text-[#6B6B6B] overflow-auto">
                  {JSON.stringify(result.instruction, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 功能说明 */}
      <Card className="bg-[#F7F6F3]">
        <CardHeader>
          <CardTitle className="text-lg">支持的功能</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium text-[#3D3D3D] mb-1">片段拼接</h4>
              <p className="text-[#6B6B6B]">指定要保留的视频时间段，自动拼接</p>
            </div>
            <div>
              <h4 className="font-medium text-[#3D3D3D] mb-1">转场效果</h4>
              <p className="text-[#6B6B6B]">淡入淡出、溶解、擦除等多种效果</p>
            </div>
            <div>
              <h4 className="font-medium text-[#3D3D3D] mb-1">智能配乐</h4>
              <p className="text-[#6B6B6B]">自动匹配背景音乐，可调节音量</p>
            </div>
            <div>
              <h4 className="font-medium text-[#3D3D3D] mb-1">调色预设</h4>
              <p className="text-[#6B6B6B]">复古、电影感、暖色调等多种风格</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
