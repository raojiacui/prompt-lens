import { describe, it, expect } from "vitest";
import { ALL_TOOLS, getTool, getToolNames, describeTools } from "@/lib/agent/tools";
import { webSearchMockTool } from "@/lib/agent/tools/web-search-mock";
import { analyzePromptGoalTool } from "@/lib/agent/tools/analyze-prompt-goal";
import { makeToolContext } from "./agent-test-utils";

describe("Agent Tool Registry", () => {
  it("registers at least 7 core tools", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(7);
  });

  it("registers all required core tools by name", () => {
    const names = getToolNames();
    for (const required of [
      "web_search_mock",
      "analyze_prompt_goal",
      "generate_research_report",
      "create_video_prompt",
      "suggest_video_workflow",
      "save_agent_artifact",
      "existing_history_lookup",
    ]) {
      expect(names).toContain(required);
      expect(getTool(required)).toBeDefined();
    }
  });

  it("registers the two bonus integration tools", () => {
    const names = getToolNames();
    expect(names).toContain("call_existing_analyze_api");
    expect(names).toContain("call_existing_video_generate_api");
  });

  it("every tool has name, description, inputSchema.safeParse and execute", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(typeof tool.inputSchema.safeParse).toBe("function");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("describeTools returns name+description pairs", () => {
    const list = describeTools();
    expect(list.length).toBe(ALL_TOOLS.length);
    expect(list[0].name).toBeTruthy();
  });
});

describe("web_search_mock", () => {
  it("returns search-shaped sources with confidence and insightTags", async () => {
    const ctx = makeToolContext();
    const result = await webSearchMockTool.execute(
      { query: "TikTok skincare ad trends", platform: "tiktok", locale: "en" },
      ctx
    );
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(Array.isArray(data.sources)).toBe(true);
    expect((data.sources as unknown[]).length).toBeGreaterThan(0);
    const source = (data.sources as Array<Record<string, unknown>>)[0];
    expect(source).toHaveProperty("title");
    expect(source).toHaveProperty("url");
    expect(source).toHaveProperty("snippet");
    expect(source).toHaveProperty("publishedAt");
    expect(source).toHaveProperty("confidence");
    expect(source).toHaveProperty("insightTags");
    expect(Array.isArray(data.keywords)).toBe(true);
    expect(Array.isArray(data.trends)).toBe(true);
    expect(Array.isArray(data.opportunities)).toBe(true);
    expect(Array.isArray(data.risks)).toBe(true);
  });

  it("rejects empty query", async () => {
    const ctx = makeToolContext();
    const result = await webSearchMockTool.execute({ query: "" }, ctx);
    expect(result.success).toBe(false);
  });

  it("stores results in sharedContext", async () => {
    const ctx = makeToolContext();
    await webSearchMockTool.execute({ query: "viral hooks" }, ctx);
    expect(ctx.sharedContext.search).toBeTruthy();
  });
});

describe("analyze_prompt_goal", () => {
  it("extracts a structured brief", async () => {
    const ctx = makeToolContext();
    const result = await analyzePromptGoalTool.execute(
      { userGoal: "Create a TikTok ad for my new hydrating serum targeting Gen Z", attachments: [] },
      ctx
    );
    expect(result.success).toBe(true);
    const brief = (result.data as { structuredBrief: Record<string, unknown> }).structuredBrief;
    expect(brief.industry).toMatch(/Skincare|Beauty/);
    expect(brief.platform).toMatch(/TikTok/);
    expect(brief.audience).toBeTruthy();
    expect(Array.isArray(brief.assetNeeds)).toBe(true);
    expect(ctx.sharedContext.brief).toBeTruthy();
  });

  it("rejects empty goal", async () => {
    const ctx = makeToolContext();
    const result = await analyzePromptGoalTool.execute({ userGoal: "" }, ctx);
    expect(result.success).toBe(false);
  });
});
