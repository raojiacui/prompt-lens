"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

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

type Tab = "analyze" | "history" | "settings" | "audio" | "edit" | "stats";

interface AudioAnalyzeTabProps {
  activeTab: Tab;
}

export function AudioAnalyzeTab({ activeTab }: AudioAnalyzeTabProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>(""); // 保存原始视频URL用于剪辑
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
  const [whisperModel, setWhisperModel] = useState("small");
  const [llmProvider, setLlmProvider] = useState("deepseek");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [videoUrlInput, setVideoUrlInput] = useState("");
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
      setProgress("正在上传文件...");

      try {
        // 1. 上传视频
        const formData = new FormData();
        formData.append("file", selectedFile);

        let uploadRes;
        try {
          uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        } catch (fetchError: any) {
          console.error("Upload fetch error:", fetchError);
          throw new Error(`上传请求失败: ${fetchError.message}\n请检查 Next.js 服务器是否在运行`);
        }

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          console.error("Upload failed:", uploadRes.status, errText);
          throw new Error(`上传失败 (${uploadRes.status}): ${errText}`);
        }

        const uploadData = await uploadRes.json();
        url = uploadData.url;
      } catch (error: any) {
        alert(`上传失败: ${error.message}`);
        setIsLoading(false);
        return;
      }
    } else {
      // URL 模式
      if (!videoUrlInput.trim()) {
        alert("请输入视频 URL");
        return;
      }
      setIsLoading(true);
      setProgress("正在下载视频...");
      url = videoUrlInput.trim();
    }

    setVideoUrl(url); // 保存原始视频URL

    try {
      setProgress("正在提取音频并识别...");

      // 2. 音频分析
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
          }),
        });
      } catch (fetchError: any) {
        // 网络错误
        console.error("Network fetch error:", fetchError);
        throw new Error(`网络请求失败: ${fetchError.message}\n请检查：\n1. Next.js 服务器是否在运行 (pnpm dev)\n2. 网络是否正常`);
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

      // 默认全选所有片段
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
        <Card className="bg-white border-[#B8C5D6]/30 shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#3D3D3D] flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-[#7C9A92]/10 flex items-center justify-center text-[#7C9A92]">🎵</span>
              音频分析
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 输入方式切换 */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => { setInputMode("file"); resetUpload(); }}
                className={`px-4 py-2 text-sm rounded-lg transition-all ${
                  inputMode === "file"
                    ? "bg-[#7C9A92] text-white"
                    : "bg-[#F7F6F3] text-[#6B6B6B] hover:bg-[#F7F6F3]/80"
                }`}
              >
                上传文件
              </button>
              <button
                onClick={() => { setInputMode("url"); resetUpload(); }}
                className={`px-4 py-2 text-sm rounded-lg transition-all ${
                  inputMode === "url"
                    ? "bg-[#7C9A92] text-white"
                    : "bg-[#F7F6F3] text-[#6B6B6B] hover:bg-[#F7F6F3]/80"
                }`}
              >
                输入 URL
              </button>
            </div>

            {/* URL 输入模式 */}
            {inputMode === "url" && (
              <div className="space-y-2">
                <Input
                  type="url"
                  value={videoUrlInput}
                  onChange={(e) => setVideoUrlInput(e.target.value)}
                  placeholder="输入视频 URL，如 https://example.com/video.mp4"
                  className="border-[#B8C5D6] focus:border-[#7C9A92]"
                />
                <p className="text-xs text-[#6B6B6B]">支持 MP4, MOV, AVI, MKV 等格式的直链</p>
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
                isDragging ? "border-[#7C9A92] bg-[#7C9A92]/5" : "border-[#B8C5D6] hover:border-[#7C9A92]/50",
                preview && "border-transparent bg-[#F7F6F3]"
              )}
            >
              {preview ? (
                <div className="relative">
                  <video src={preview} className="max-h-48 rounded-lg shadow-md" controls />
                  <button
                    onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-[#D4A574] text-white rounded-full flex items-center justify-center shadow-md hover:bg-[#C49564]"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#7C9A92]/10 flex items-center justify-center">
                    <svg className="w-7 h-7 text-[#7C9A92]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <p className="text-[#3D3D3D] font-medium mb-1">点击或拖拽视频文件</p>
                  <p className="text-sm text-[#6B6B6B]">支持 MP4, MOV, AVI, MKV</p>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />
            </div>
            )}

            {selectedFile && (
              <div className="flex items-center justify-between bg-[#F7F6F3] rounded-lg px-4 py-2">
                <span className="text-sm text-[#6B6B6B] truncate">{selectedFile.name}</span>
                <span className="text-xs text-[#7C9A92] bg-[#7C9A92]/10 px-2 py-1 rounded">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            )}

            {/* 设置选项 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#3D3D3D] block mb-2">Whisper 模型</label>
                <select
                  value={whisperModel}
                  onChange={(e) => setWhisperModel(e.target.value)}
                  className="w-full h-10 px-3 border border-[#B8C5D6] rounded-lg focus:border-[#7C9A92] outline-none bg-white"
                >
                  <option value="tiny">tiny (最快)</option>
                  <option value="base">base</option>
                  <option value="small">small (推荐)</option>
                  <option value="medium">medium</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-[#3D3D3D] block mb-2">LLM 提供商</label>
                <select
                  value={llmProvider}
                  onChange={(e) => setLlmProvider(e.target.value)}
                  className="w-full h-10 px-3 border border-[#B8C5D6] rounded-lg focus:border-[#7C9A92] outline-none bg-white"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="zhipu">智谱AI</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[#3D3D3D] block mb-2">自定义提示词（可选）</label>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="例如：提取产品演示和价格介绍部分"
                className="border-[#B8C5D6] focus:border-[#7C9A92]"
                rows={2}
              />
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={(inputMode === "file" && !selectedFile) || (inputMode === "url" && !videoUrlInput.trim()) || isLoading}
              className="w-full h-11 bg-[#7C9A92] hover:bg-[#6B8A82] text-white rounded-xl font-medium"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" className="border-white" />
                  {progress || "处理中..."}
                </span>
              ) : (
                "开始音频分析"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* 右侧：结果区域 */}
        <Card className="bg-white border-[#B8C5D6]/30 shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#3D3D3D] flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-[#D4A574]/10 flex items-center justify-center text-[#D4A574]">📝</span>
              分析结果
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-4">
                {/* 基本信息 */}
                <div className="flex items-center gap-4 text-sm text-[#6B6B6B] bg-[#F7F6F3] rounded-lg px-3 py-2">
                  <span>语言: {result.language}</span>
                  <span>时长: {formatTime(result.duration)}</span>
                  <span>片段: {result.segments.length} 个</span>
                </div>

                {/* 片段列表 */}
                <div className="max-h-[350px] overflow-y-auto space-y-2">
                  <p className="text-sm font-medium text-[#3D3D3D] mb-2">选择要保留的片段：</p>
                  {result.segments.map((seg, i) => (
                    <div
                      key={i}
                      onClick={() => toggleSegment(i)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all",
                        selectedSegments.includes(i)
                          ? "bg-[#7C9A92]/10 border border-[#7C9A92]/30"
                          : "bg-[#F7F6F3] hover:bg-[#F7F6F3]/80"
                      )}
                    >
                      <Checkbox
                        checked={selectedSegments.includes(i)}
                        onChange={() => toggleSegment(i)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-[#7C9A92] bg-[#7C9A92]/10 px-2 py-0.5 rounded">
                            {formatTime(seg.start)} - {formatTime(seg.end)}
                          </span>
                          {seg.tags.slice(0, 2).map((tag, j) => (
                            <span key={j} className="text-xs text-[#6B6B6B]">#{tag}</span>
                          ))}
                        </div>
                        <p className="text-sm text-[#3D3D3D] line-clamp-2">{seg.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 剪辑按钮 */}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={handleClip}
                    disabled={selectedSegments.length === 0 || clipLoading}
                    className="flex-1 h-10 bg-[#D4A574] hover:bg-[#C49564] text-white rounded-lg font-medium"
                  >
                    {clipLoading ? (
                      <span className="flex items-center gap-2">
                        <Spinner size="sm" className="border-white" />
                        剪辑中...
                      </span>
                    ) : (
                      `剪辑选中片段 (${selectedSegments.length})`
                    )}
                  </Button>
                </div>

                {/* 剪辑结果 */}
                {clipUrl && (
                  <div className="mt-4 p-4 bg-[#7C9A92]/10 rounded-lg">
                    <p className="text-sm font-medium text-[#7C9A92] mb-2">剪辑完成！</p>
                    <video src={clipUrl} className="w-full rounded-lg" controls />
                    <a
                      href={clipUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mt-2 text-sm text-[#7C9A92] hover:underline"
                    >
                      点击下载视频 ↗
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#B8C5D6]/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-[#B8C5D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <p className="text-[#6B6B6B]">上传视频，点击"开始音频分析"</p>
                <p className="text-sm text-[#B8C5D6] mt-1">自动识别语音并智能分段</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 文字稿区域 */}
      {result && (
        <Card className="bg-white border-[#B8C5D6]/30 shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#3D3D3D] text-sm">完整文字稿</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto bg-[#F7F6F3] rounded-lg p-4">
              {result.transcription.map((seg, i) => (
                <span key={i} className="text-sm text-[#3D3D3D]">
                  <span className="text-xs text-[#7C9A92] mr-2">[{formatTime(seg.start)}]</span>
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
