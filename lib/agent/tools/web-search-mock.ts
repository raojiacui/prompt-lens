import { z } from "zod";
import type { ToolDefinition } from "../types";
import { runMockSearch } from "../mock-data";
import { logTool, ok, fail } from "./shared";

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  market: z.string().max(20).optional(),
  platform: z.string().max(40).optional(),
  locale: z.string().max(10).optional(),
});

/**
 * web_search_mock —— 模拟联网搜索。
 *
 * 输出结构刻意对齐真实搜索服务（Tavily/Exa/SerpAPI/Bing）：
 * sources[]（title/url/snippet/publishedAt/confidence/insightTags）、
 * keywords、trends、opportunities、risks。
 *
 * 接入真实搜索时，新建 web_search_tavily.ts 等同名工具替换注册即可，
 * executor / planner 不需要任何改动。
 */
export const webSearchMockTool: ToolDefinition = {
  name: "web_search_mock",
  description:
    "Search the web (mock) for trends, competitor ads, keywords and source summaries. Returns sources, insights, keywords and risks. Replace with Tavily/Exa/SerpAPI/Bing in production.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("Invalid search input: " + parsed.error.errors[0]?.message);
    }
    logTool(ctx, "web_search_mock", "start", { query: parsed.data.query });

    try {
      const result = runMockSearch({
        query: parsed.data.query,
        market: parsed.data.market,
        platform: parsed.data.platform,
        locale: parsed.data.locale || ctx.locale,
      });

      // 存入共享上下文，供后续工具使用
      ctx.sharedContext.search = result;

      logTool(ctx, "web_search_mock", "done", { sources: result.sources.length });
      return ok(result, `Found ${result.sources.length} sources across ${result.trends.length} trend signals.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed";
      logTool(ctx, "web_search_mock", "error", message);
      return fail(message, "Search failed.");
    }
  },
};
