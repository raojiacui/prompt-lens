import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail, getBrief } from "./shared";
import { MOCK_HISTORY_SUGGESTIONS } from "../mock-data";

const inputSchema = z.object({
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

/**
 * existing_history_lookup
 *
 * 从当前用户历史（analysis_history / video_generation）中查找相关记录。
 * storage.findRelevantHistory 由存储层实现：
 *   - Drizzle 存储 → 真实查询 Postgres
 *   - JSON 存储 → 返回空数组，由本工具补充 mock reuse suggestions
 * 保持用户隔离（ctx.userId 由 executor 注入）。
 */
export const existingHistoryLookupTool: ToolDefinition = {
  name: "existing_history_lookup",
  description:
    "Search the current user's own analysis and video-generation history for relevant past prompts/analyses to reuse.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "existing_history_lookup", "start");

    const brief = getBrief(ctx);
    const query =
      parsed.data.query ||
      (brief ? [brief.industry, brief.platform, brief.creativeObjective].filter(Boolean).join(" ") : "") ||
      (ctx.sharedContext.goal as string) ||
      "";

    let matched: Array<{ id: string; title: string; snippet: string; createdAt: string }> = [];
    try {
      matched = await ctx.findHistory(query, parsed.data.limit ?? 5);
    } catch (error) {
      logTool(ctx, "existing_history_lookup", "error", error);
    }

    const reuseSuggestions =
      matched.length > 0
        ? matched.map((m) => `Reuse "${m.title}" — ${m.snippet}`)
        : MOCK_HISTORY_SUGGESTIONS.map((s) => `${s.title}: ${s.snippet}`);

    const result = {
      query,
      matchedHistory: matched,
      reuseSuggestions,
      usedMock: matched.length === 0,
    };
    ctx.sharedContext.historyLookup = result;

    await ctx.saveArtifact({
      type: "history_lookup",
      title: "History Lookup",
      content: result,
      metadata: { matchCount: matched.length, usedMock: matched.length === 0 },
    });

    logTool(ctx, "existing_history_lookup", "done", { matches: matched.length });
    return ok(result, matched.length > 0 ? `Found ${matched.length} relevant history items.` : "No matching history; added reuse suggestions.");
  },
};
