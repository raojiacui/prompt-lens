/** 工具内部共享的辅助函数 */
import { z } from "zod";
import type { ToolContext, ToolResult } from "../types";

/** 统一记录工具开始/结束日志 */
export function logTool(ctx: ToolContext, toolName: string, stage: "start" | "done" | "error", details?: unknown) {
  ctx.log(`[tool:${toolName}] ${stage}`, details);
}

export function ok<T = Record<string, unknown>>(data: T, summary: string): ToolResult<T> {
  return { success: true, data, summary };
}

export function fail(error: string, summary?: string): ToolResult {
  return { success: false, error, summary: summary ?? error };
}

/** 从共享上下文中读取 brief（analyze_prompt_goal 产出） */
export function getBrief(ctx: ToolContext): Record<string, unknown> | null {
  const brief = ctx.sharedContext.brief;
  return brief && typeof brief === "object" ? (brief as Record<string, unknown>) : null;
}

/** 从共享上下文中读取搜索结果（web_search_mock 产出） */
export function getSearchResults(ctx: ToolContext): Record<string, unknown> | null {
  const s = ctx.sharedContext.search;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : null;
}

/** 常见输入字段，供多个工具复用 */
export const localeField = z.string().max(10).optional();
export const queryField = z.string().min(1).max(500);
