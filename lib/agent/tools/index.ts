/**
 * Agent Tool Registry
 *
 * 集中注册所有工具。executor 通过 name 查找工具执行，避免在 API route 里写 if/else。
 * 新增工具只需：实现 ToolDefinition → 在此注册 → planner fallback 模板可引用。
 */

import type { ToolDefinition } from "../types";
import { webSearchMockTool } from "./web-search-mock";
import { analyzePromptGoalTool } from "./analyze-prompt-goal";
import { generateResearchReportTool } from "./generate-research-report";
import { createVideoPromptTool } from "./create-video-prompt";
import { suggestVideoWorkflowTool } from "./suggest-video-workflow";
import { saveAgentArtifactTool } from "./save-agent-artifact";
import { existingHistoryLookupTool } from "./existing-history-lookup";
import { callExistingAnalyzeApiTool } from "./call-existing-analyze-api";
import { callExistingVideoGenerateApiTool } from "./call-existing-video-generate-api";

export const ALL_TOOLS: ToolDefinition[] = [
  analyzePromptGoalTool,
  webSearchMockTool,
  existingHistoryLookupTool,
  generateResearchReportTool,
  createVideoPromptTool,
  suggestVideoWorkflowTool,
  callExistingAnalyzeApiTool,
  callExistingVideoGenerateApiTool,
  saveAgentArtifactTool,
];

const TOOL_MAP: Map<string, ToolDefinition> = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name);
}

export function getToolNames(): string[] {
  return ALL_TOOLS.map((t) => t.name);
}

export function describeTools(): Array<{ name: string; description: string }> {
  return ALL_TOOLS.map((t) => ({ name: t.name, description: t.description }));
}
