"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { AgentAttachmentPreview } from "./agent-attachment-preview";
import { AgentSuggestionChips } from "./agent-suggestion-chips";
import { AGENT_SUGGESTIONS } from "./agent-suggestions";
import type { AgentAttachment } from "@/lib/agent/types";

interface Props {
  onSubmit: (goal: string, attachments: AgentAttachment[]) => void;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  variant?: "default" | "overlay";
}

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export function AgentComposer({ onSubmit, loading, disabled, compact, variant = "default" }: Props) {
  const [goal, setGoal] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 自适应高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, variant === "overlay" ? 96 : 220)}px`;
  }, [goal, variant]);

  const canSend = goal.trim().length > 0 && !loading && !disabled;

  const pickSuggestion = (text: string) => {
    if (loading || disabled) return;
    setGoal((prev) => {
      const base = prev.trim();
      return base ? `${base} ${text}` : text;
    });
    textareaRef.current?.focus();
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const next: AgentAttachment[] = [];
    for (const file of Array.from(files)) {
      const isImage = ALLOWED_IMAGE.includes(file.type);
      const isVideo = ALLOWED_VIDEO.includes(file.type);
      if (!isImage && !isVideo) {
        setError(`Unsupported file type: ${file.name}`);
        continue;
      }
      if (isImage && file.size > MAX_IMAGE_BYTES) {
        setError(`Image ${file.name} is larger than 6MB`);
        continue;
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        setError(`Video ${file.name} is larger than 150MB`);
        continue;
      }
      const att: AgentAttachment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        type: file.type,
        size: file.size,
      };
      // 图片读取 data URL 供后端 mock 分析使用；视频只保存元数据
      if (isImage) {
        att.dataUrl = await fileToDataUrl(file);
      }
      next.push(att);
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = () => {
    if (!canSend) return;
    setError(null);
    onSubmit(goal.trim(), attachments);
    // 提交后清空；运行中 loading=true，输入区进入 disabled 状态
    setGoal("");
    setAttachments([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const overlay = variant === "overlay";

  return (
    <div className={cn("mx-auto w-full", overlay ? "max-w-[520px] md:max-w-[600px]" : compact ? "max-w-3xl" : "max-w-3xl")}>
      {!compact && !overlay && (
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#D8D5CC]/70 bg-white/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#D97757] shadow-sm backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D97757] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D97757]" />
            </span>
            Agentic Workflow
          </div>
          <h2
            className="mt-4 text-3xl font-bold tracking-tight text-[#141413] md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Create with Agent
          </h2>
          <p className="mt-2 text-base text-[#6B6860] md:text-lg">
            Describe a creative goal — the agent plans, researches, builds prompts and saves deliverables.
          </p>
        </div>
      )}

      <div
        className={cn(
          "relative border transition-all",
          overlay
            ? "rounded-[12px] border-white/25 bg-white/15 shadow-[0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-xl ring-1 ring-white/15 focus-within:border-white/60 focus-within:ring-1 focus-within:ring-white/30"
            : "rounded-3xl border-[#D8D5CC]/80 bg-[#FFFDF8]/90 shadow-[0_18px_50px_rgba(20,20,19,0.07)] backdrop-blur-sm focus-within:border-[#D97757]/55 focus-within:shadow-[0_22px_60px_rgba(217,119,87,0.12)]",
          (loading || disabled) && "opacity-70"
        )}
      >
        <AgentAttachmentPreview attachments={attachments} onRemove={removeAttachment} />

        <textarea
          ref={textareaRef}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading || disabled}
          rows={1}
          placeholder="e.g. Research TikTok skincare ad trends and create a video prompt for my serum…"
          className={cn(
            "block max-h-[220px] w-full resize-none overflow-y-auto bg-transparent px-3.5 py-1.5 text-xs leading-relaxed text-[#141413] outline-none focus-visible:shadow-none disabled:cursor-not-allowed md:text-sm",
            overlay ? "max-h-[96px] min-h-[34px] py-1.5 text-sm leading-5 text-white placeholder:text-white/62" : "min-h-[64px] pb-7 placeholder:text-[#AAA9A6]"
          )}
        />

        {error && (
          <div className="flex items-center justify-between gap-3 border-t border-[#F0D9CF] bg-[#FDF1ED] px-5 py-2 text-sm text-[#C0453A]">
            <span className="truncate">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className={cn("flex items-center justify-between gap-2 border-t", overlay ? "border-white/15 px-2.5 py-1" : "border-[#E4E2DD]/70 px-3 py-1.5")}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || disabled}
              aria-label="Attach image or video"
              title="Attach image or video"
              className={cn("inline-flex items-center justify-center rounded-full transition-colors focus-visible:shadow-none disabled:opacity-50", overlay ? "h-5 w-5 border border-white/28 bg-white/10 text-white hover:bg-white/20" : "h-6 w-6 text-[#9C9890] hover:bg-[#F5F3EC] hover:text-[#D97757]")}
            >
              <Paperclip className={cn(overlay ? "h-3 w-3" : "h-3.5 w-3.5")} />
            </button>
            <span className={cn("ml-1 hidden text-xs sm:inline", overlay ? "text-white/62" : "text-[#9C9890]")}>
              Attach image / video · ⌘/Ctrl + Enter to run
            </span>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            aria-label="Create agent run"
            className={cn(
              "inline-flex items-center justify-center rounded-xl text-white shadow-sm transition-all focus-visible:shadow-none",
              canSend
                ? overlay
                  ? "h-6 w-6 bg-white/22 text-white hover:bg-white/32 hover:shadow-md"
                  : "h-7 w-7 bg-[#D97757] hover:bg-[#C96848] hover:shadow-md"
                : overlay ? "h-6 w-6 cursor-not-allowed bg-white/15 text-white/46" : "h-7 w-7 cursor-not-allowed bg-[#E2DED5] text-[#B5B1A8]"
            )}
          >
            {loading ? <Spinner size="sm" className="text-white" /> : <ArrowUp className={cn(overlay ? "h-3 w-3" : "h-3.5 w-3.5")} />}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <AgentSuggestionChips suggestions={AGENT_SUGGESTIONS} onPick={pickSuggestion} disabled={loading || disabled} variant={overlay ? "overlay" : "default"} />
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
