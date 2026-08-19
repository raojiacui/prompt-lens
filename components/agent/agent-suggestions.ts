/** Agent composer 的 suggestion chips 与文案，集中管理 */
import type { AgentTaskKind } from "@/lib/agent/types";

export const AGENT_SUGGESTIONS: string[] = [
  "Research TikTok skincare ad trends and turn them into a video prompt",
  "Turn my product idea into a complete video plan",
  "Analyze a competitor video and create differentiated prompts",
  "Generate a launch video workflow for my new product",
  "Find viral hooks for my product category and draft a shot list",
  "Break down a winning ad structure I can reuse",
];

export function taskKindLabel(kind: AgentTaskKind | null): string {
  switch (kind) {
    case "trend_research":
      return "Trend research";
    case "video_analysis":
      return "Video analysis";
    case "video_prompt_generation":
      return "Video prompt";
    case "product_launch_video":
      return "Launch video";
    case "competitor_breakdown":
      return "Competitor breakdown";
    case "generic":
      return "Creative workflow";
    default:
      return "Workflow";
  }
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "planning":
      return "Planning your workflow…";
    case "running":
      return "Running";
    case "waiting_for_user":
      return "Waiting for you";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
