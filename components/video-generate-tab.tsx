"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export function VideoGenerateTab() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState("10");
  const [resolution, setResolution] = useState("720p");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [records, setRecords] = useState<any[]>([]);

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

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setStatus("正在创建任务...");
    setVideoUrl(null);

    try {
      const res = await fetch("/api/video-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, duration: Number(duration), resolution, negativePrompt }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || "创建失败");
      }

      const data = await res.json();
      if (!data.taskId) throw new Error("创建失败：缺少任务 ID");
      if (data.record) {
        setRecords((prev) => [data.record, ...prev.filter((item) => item.taskId !== data.record.taskId)]);
      }
      setStatus("视频生成中...");

      const taskId = data.taskId;
      pollStatus(taskId);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      setIsGenerating(false);
    }
  };

  const pollStatus = async (taskId: string) => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/video-generate/status?taskId=${taskId}`);
        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          throw new Error(errorData?.error || "查询状态失败");
        }
        const data = await res.json();

        if (data.status === "completed") {
          setVideoUrl(data.videoUrl);
          setStatus("生成完成！");
          setIsGenerating(false);
          if (data.record) {
            setRecords((prev) => prev.map((item) => item.taskId === taskId ? data.record : item));
          }
          return true;
        } else if (data.status === "failed") {
          setStatus(`生成失败: ${data.error}`);
          setIsGenerating(false);
          if (data.record) {
            setRecords((prev) => prev.map((item) => item.taskId === taskId ? data.record : item));
          }
          return true;
        } else {
          setStatus(`生成中... ${data.progress || ""}`);
          if (data.record) {
            setRecords((prev) => prev.map((item) => item.taskId === taskId ? data.record : item));
          }
          return false;
        }
      } catch (error: any) {
        setStatus(error.message || "查询状态失败");
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
    setStatus(record.status === "completed" ? "生成完成！" : `生成中... ${record.progress || ""}`);

    if (record.status === "pending" || record.status === "processing") {
      setIsGenerating(true);
      pollStatus(record.taskId);
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
              输入提示词
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的视频内容..."
              className="min-h-[180px] border-[#D8D5CC] focus:border-[#D97757]"
            />

            {/* 设置选项 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">时长</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
                >
                  <option value="5">5 秒</option>
                  <option value="10">10 秒</option>
                  <option value="15">15 秒</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-[#141413] block mb-2">分辨率</label>
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

            <div>
              <label className="text-sm font-medium text-[#141413] block mb-2">负面提示词（可选）</label>
              <Textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="描述不想出现的元素..."
                className="bg-white border-[#C8C4BC] focus:border-[#D97757]"
                rows={2}
              />
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
                "开始生成视频"
              )}
            </Button>

            {status && (
              <div className="text-center text-sm text-[#6B6860]">{status}</div>
            )}

            {records.length > 0 && (
              <div className="border-t border-[#D8D5CC] pt-4 space-y-2">
                <div className="text-sm font-medium text-[#141413]">最近生成</div>
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
                        <div className="text-xs text-[#D97757] mt-1">已生成，点击预览</div>
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
              视频预览
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
                    下载视频
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(prompt)}
                    className="flex-1 border-[#D8D5CC]"
                  >
                    复制提示词
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[180px] text-[#9C9890]">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 text-[#D8D5CC]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p>输入提示词后点击生成视频</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
