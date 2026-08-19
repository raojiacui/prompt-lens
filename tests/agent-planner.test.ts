import { describe, it, expect } from "vitest";
import { plan, detectTaskKind } from "@/lib/agent/planner";
import { getToolNames } from "@/lib/agent/tools";

const TOOLS = getToolNames();

describe("Agent Planner", () => {
  it("detects trend research tasks", () => {
    expect(detectTaskKind("Research TikTok skincare ad trends", false)).toBe("trend_research");
    expect(detectTaskKind("调研 TikTok 上护肤品广告的爆款视频风格", false)).toBe("trend_research");
  });

  it("detects competitor breakdown", () => {
    expect(detectTaskKind("Analyze a competitor video and break it down", false)).toBe("competitor_breakdown");
  });

  it("detects product launch videos", () => {
    expect(detectTaskKind("Generate a launch video workflow for my product", false)).toBe("product_launch_video");
  });

  it("detects video prompt generation", () => {
    expect(detectTaskKind("Write a video prompt for my ad", false)).toBe("video_prompt_generation");
  });

  it("prefers video_analysis when a media attachment is present", () => {
    expect(detectTaskKind("analyze this video", true)).toBe("video_analysis");
    expect(detectTaskKind("competitor breakdown of this video", true)).toBe("competitor_breakdown");
  });

  it("produces a validated 4-7 step plan via fallback (no API key)", async () => {
    const result = await plan({
      userGoal: "Research TikTok skincare ad trends and create a video prompt for my serum",
      locale: "en",
      attachments: [],
      availableTools: TOOLS,
      provider: null,
      userId: "test-user",
    });

    expect(result.usedFallback).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(4);
    expect(result.steps.length).toBeLessThanOrEqual(7);
    expect(result.taskKind).toBe("trend_research");

    for (const step of result.steps) {
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(step.expectedOutput).toBeTruthy();
      expect(TOOLS).toContain(step.toolName);
    }

    // 趋势调研计划应包含搜索与报告/prompt/工作流/save 步骤
    const names = result.steps.map((s) => s.toolName);
    expect(names).toContain("web_search_mock");
    expect(names).toContain("generate_research_report");
    expect(names).toContain("create_video_prompt");
    expect(names).toContain("save_agent_artifact");
  });

  it("produces a launch plan with workflow step and includeLaunchSequence", async () => {
    const result = await plan({
      userGoal: "Generate a launch video workflow for my new skincare product",
      locale: "en",
      attachments: [],
      availableTools: TOOLS,
      provider: null,
      userId: "test-user",
    });
    expect(result.taskKind).toBe("product_launch_video");
    expect(result.steps.some((s) => s.toolName === "suggest_video_workflow")).toBe(true);
  });

  it("uses call_existing_analyze_api when a media attachment is present for analysis tasks", async () => {
    const result = await plan({
      userGoal: "Analyze this competitor video and create prompts",
      locale: "en",
      attachments: [{ id: "a1", name: "comp.mp4", type: "video/mp4", size: 1024 }],
      availableTools: TOOLS,
      provider: null,
      userId: "test-user",
    });
    expect(result.taskKind).toBe("competitor_breakdown");
    expect(result.steps.some((s) => s.toolName === "call_existing_analyze_api")).toBe(true);
  });

  it("always ends with save_agent_artifact", async () => {
    for (const goal of [
      "Research TikTok skincare ad trends",
      "Generate a launch video workflow",
      "Analyze a competitor video",
      "Write a video prompt",
    ]) {
      const result = await plan({
        userGoal: goal,
        locale: "en",
        attachments: [],
        availableTools: TOOLS,
        provider: null,
        userId: "test-user",
      });
      expect(result.steps[result.steps.length - 1].toolName).toBe("save_agent_artifact");
    }
  });
});
