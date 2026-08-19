"use client";

import { Copy, RefreshCw, Video, Wrench } from "lucide-react";
import type { AgentRunDetail } from "@/lib/agent/types";
import { artifactToText } from "./agent-artifact-panel";

interface Props {
  run: AgentRunDetail;
  onCopyPrompt: () => void;
  onRetry: () => void;
  onNavigateVideoGen?: (prompt: string) => void;
}

export function AgentNextActions({ run, onCopyPrompt, onRetry, onNavigateVideoGen }: Props) {
  const videoPrompt = run.artifacts.find((a) => a.type === "video_prompt");
  const nextActionsArtifact = run.artifacts.find((a) => a.type === "next_actions");
  const actions =
    nextActionsArtifact && Array.isArray((nextActionsArtifact.content as { actions?: unknown[] }).actions)
      ? ((nextActionsArtifact.content as { actions: Array<Record<string, unknown>> }).actions)
      : [];

  const promptText = videoPrompt ? artifactToText(videoPrompt) : "";

  const handleGenerateVideo = () => {
    if (onNavigateVideoGen) {
      const mainPrompt =
        videoPrompt && typeof (videoPrompt.content as { mainPrompt?: string }).mainPrompt === "string"
          ? (videoPrompt.content as { mainPrompt: string }).mainPrompt
          : run.goal;
      onNavigateVideoGen(mainPrompt);
    }
  };

  return (
    <div className="rounded-2xl border border-[#E4E2DD] bg-white/70 p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#141413]">
        <Wrench className="h-4 w-4 text-[#D97757]" />
        Next actions
      </h3>
      <div className="flex flex-wrap gap-2">
        {videoPrompt && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(promptText);
              onCopyPrompt();
            }}
            className="inline-flex items-center gap-2 rounded-full border border-[#D8D5CC] bg-white px-4 py-2 text-sm font-medium text-[#3A3A37] shadow-sm transition-colors hover:border-[#D97757]/50 hover:text-[#D97757]"
          >
            <Copy className="h-4 w-4" />
            Copy video prompt
          </button>
        )}
        {onNavigateVideoGen && (
          <button
            type="button"
            onClick={handleGenerateVideo}
            className="inline-flex items-center gap-2 rounded-full bg-[#D97757] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C96848]"
          >
            <Video className="h-4 w-4" />
            Generate video from prompt
          </button>
        )}
        {(run.status === "failed" || run.status === "cancelled") && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-full border border-[#D8D5CC] bg-white px-4 py-2 text-sm font-medium text-[#3A3A37] shadow-sm transition-colors hover:border-[#D97757]/50 hover:text-[#D97757]"
          >
            <RefreshCw className="h-4 w-4" />
            Retry run
          </button>
        )}
        {actions
          .filter((a) => String(a.action) === "refine_goal")
          .map((a, i) => (
            <span key={i} className="inline-flex items-center rounded-full bg-[#F5F3EC] px-3 py-2 text-xs text-[#6B6860]">
              {String(a.label)}
            </span>
          ))}
      </div>
    </div>
  );
}
