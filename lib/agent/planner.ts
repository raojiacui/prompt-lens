/**
 * Agent Planner
 *
 * 把用户目标转成 4-7 个结构化步骤。
 * - 优先调用现有 AI provider（lib/agent/ai-provider.ts）
 * - 无 key / 调用失败 / 返回不合法时，使用 deterministic fallback 计划
 * - 输出经过 zod 校验
 *
 * 不同任务类型有不同计划模板：
 *   趋势调研、视频分析、视频 prompt 生成、产品发布视频、竞品拆解、通用
 */

import { z } from "zod";
import type { AgentChatMessage } from "./ai-provider";
import type {
  AgentTaskKind,
  PlannerInput,
  PlannerResult,
} from "./types";

// ============ 输出 schema 校验 ============

const PlanStepSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  toolName: z.string().min(1).max(80),
  expectedOutput: z.string().min(1).max(400),
});

const PlanSchema = z.object({
  taskKind: z.enum([
    "trend_research",
    "video_analysis",
    "video_prompt_generation",
    "product_launch_video",
    "competitor_breakdown",
    "generic",
  ]),
  steps: z.array(PlanStepSchema).min(3).max(7),
});

// ============ 任务类型识别 ============

export function detectTaskKind(goal: string, hasMediaAttachment: boolean): AgentTaskKind {
  const q = goal.toLowerCase();
  const wantsResearch =
    /research|trend|viral|爆款|趋势|调研|调研|find|discover|what('?s| is) (hot|working)|market/.test(q);
  const wantsCompetitor = /competitor|竞品|拆解|teardown|benchmark|vs\b/.test(q);
  const wantsPrompt =
    /prompt|提示词|write (a |me )?(prompt|video)|generate (a |me )?(prompt|video prompt)|script|shot ?list/.test(q);
  const wantsLaunch = /launch|发布|上线|campaign|新品|introductory|go-to-market/.test(q);
  const wantsAnalysis = /analy[sz]e|analyze|分析|review|breakdown|拆解|look at (this|the) video/.test(q);

  // 有附件且明确要分析 → 视频分析
  if (hasMediaAttachment && (wantsAnalysis || wantsCompetitor)) {
    return wantsCompetitor ? "competitor_breakdown" : "video_analysis";
  }
  if (wantsCompetitor) return "competitor_breakdown";
  if (wantsLaunch) return "product_launch_video";
  if (wantsResearch) return "trend_research";
  if (wantsPrompt) return "video_prompt_generation";
  if (wantsAnalysis) return "video_analysis";
  return "generic";
}

// ============ AI 规划 ============

function buildPlannerMessages(input: PlannerInput, taskKind: AgentTaskKind): AgentChatMessage[] {
  const attachmentInfo = input.attachments
    .map((a, i) => `${i + 1}. ${a.name} (${a.type}, ${Math.round(a.size / 1024)}KB)`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "You are an expert creative-ops planner for Prompt Lens, a short-form video tool.",
        "You break a user's creative goal into a 4-7 step execution plan.",
        "Each step uses exactly one tool from the available tool list.",
        "Respond ONLY with valid JSON, no markdown fences, matching this shape:",
        `{ "taskKind": "${taskKind}", "steps": [ { "title": string, "description": string, "toolName": string, "expectedOutput": string } ] }`,
        "Keep steps concrete and sequential. Steps should gather context, analyze, produce a video prompt/workflow, and save artifacts.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `User goal: ${input.userGoal}`,
        `Detected task kind: ${taskKind}`,
        `Locale: ${input.locale}`,
        input.attachments.length ? `Attachments:\n${attachmentInfo}` : "Attachments: none",
        `Available tools: ${input.availableTools.join(", ")}`,
        "Produce the plan now.",
      ].join("\n"),
    },
  ];
}

async function planWithAI(input: PlannerInput, taskKind: AgentTaskKind): Promise<PlannerResult | null> {
  // 动态导入，避免在无 DB 环境（仅测试 fallback 路径）加载 @/lib/ai/chat → @/lib/db
  const { tryAgentChat, extractJson } = await import("./ai-provider");
  const messages: AgentChatMessage[] = buildPlannerMessages(input, taskKind);
  const result = await tryAgentChat(input.userId, messages, input.provider);
  if (!result) return null;

  const parsed = extractJson(result.content);
  if (!parsed) return null;

  const validated = PlanSchema.safeParse(parsed);
  if (!validated.success) {
    console.warn("[planner] AI plan failed validation:", validated.error.flatten());
    return null;
  }

  // 确保所有 toolName 都在可用工具集内，否则替换为相近工具
  const available = new Set(input.availableTools);
  const steps = validated.data.steps.map((s) => ({
    ...s,
    toolName: available.has(s.toolName) ? s.toolName : "generate_research_report",
  }));

  return {
    taskKind: validated.data.taskKind,
    steps,
    usedFallback: false,
    raw: result.content,
  };
}

// ============ Deterministic fallback 计划 ============

type FallbackPlan = Omit<PlannerResult, "usedFallback">;

function fallbackPlan(kind: AgentTaskKind, input: PlannerInput): FallbackPlan {
  const hasMedia = input.attachments.length > 0;

  const plans: Record<AgentTaskKind, FallbackPlan> = {
    trend_research: {
      taskKind: "trend_research",
      steps: [
        {
          title: "Analyze the creative goal",
          description: "Extract the industry, target platform, audience and creative objective from the request.",
          toolName: "analyze_prompt_goal",
          expectedOutput: "A structured creative brief with industry, platform, audience and asset needs.",
        },
        {
          title: "Research trending ad styles",
          description: "Search for trending ad formats, hooks and creative patterns for the product category.",
          toolName: "web_search_mock",
          expectedOutput: "A list of sources, keywords, trend signals, opportunities and risks.",
        },
        {
          title: "Look for reusable past work",
          description: "Search the user's own history for relevant analyses or prompts that can be reused.",
          toolName: "existing_history_lookup",
          expectedOutput: "Matched history items and reuse suggestions.",
        },
        {
          title: "Synthesize a research report",
          description: "Combine the brief and search findings into a structured research report.",
          toolName: "generate_research_report",
          expectedOutput: "A report with summary, opportunities, creative angles and risk notes.",
        },
        {
          title: "Draft a ready-to-use video prompt",
          description: "Turn the strongest creative angle into a production-ready video prompt.",
          toolName: "create_video_prompt",
          expectedOutput: "Main prompt, negative prompt, shot list and style notes.",
        },
        {
          title: "Assemble a production workflow",
          description: "Recommend a step-by-step workflow and platform settings to produce the video.",
          toolName: "suggest_video_workflow",
          expectedOutput: "Production steps, recommended settings and platform advice.",
        },
        {
          title: "Save all deliverables",
          description: "Persist the report, prompt and workflow as artifacts for later reuse.",
          toolName: "save_agent_artifact",
          expectedOutput: "Saved artifact references.",
        },
      ],
    },
    competitor_breakdown: {
      taskKind: "competitor_breakdown",
      steps: [
        {
          title: "Analyze the creative goal",
          description: "Clarify which competitor/creative to break down and what to extract.",
          toolName: "analyze_prompt_goal",
          expectedOutput: "A structured brief naming the competitor and dimensions to analyze.",
        },
        ...(hasMedia
          ? [
              {
                title: "Analyze the attached competitor media",
                description: "Run the existing visual analysis on the attached competitor video or image.",
                toolName: "call_existing_analyze_api",
                expectedOutput: "Shot structure, visual style and a reusable prompt extracted from the media.",
              },
            ]
          : [
              {
                title: "Research competitor creative patterns",
                description: "Search for public competitor ads and teardowns to ground the breakdown.",
                toolName: "web_search_mock",
                expectedOutput: "Sources describing the competitor's hook, structure and CTA patterns.",
              },
            ]),
        {
          title: "Look for reusable past work",
          description: "Check the user's history for prior analyses of similar creatives.",
          toolName: "existing_history_lookup",
          expectedOutput: "Matched history items and reuse suggestions.",
        },
        {
          title: "Synthesize a teardown report",
          description: "Produce a structured teardown with structure, strengths, weaknesses and opportunities.",
          toolName: "generate_research_report",
          expectedOutput: "A teardown report with creative angles and risk notes.",
        },
        {
          title: "Create a differentiated video prompt",
          description: "Create a prompt that borrows what works but differentiates the user's product.",
          toolName: "create_video_prompt",
          expectedOutput: "Main prompt, negative prompt, shot list and style notes.",
        },
        {
          title: "Save all deliverables",
          description: "Persist the teardown and prompt as artifacts.",
          toolName: "save_agent_artifact",
          expectedOutput: "Saved artifact references.",
        },
      ],
    },
    video_analysis: {
      taskKind: "video_analysis",
      steps: [
        {
          title: "Analyze the creative goal",
          description: "Clarify what to extract from the attached video or image.",
          toolName: "analyze_prompt_goal",
          expectedOutput: "A structured brief with analysis focus.",
        },
        ...(hasMedia
          ? [
              {
                title: "Analyze the attached media",
                description: "Run the existing visual analysis on the attached video/image frames.",
                toolName: "call_existing_analyze_api",
                expectedOutput: "A detailed visual analysis and reusable prompt.",
              },
            ]
          : [
              {
                title: "Research reference styles",
                description: "No media attached — search for reference styles matching the goal.",
                toolName: "web_search_mock",
                expectedOutput: "Reference sources and style patterns.",
              },
            ]),
        {
          title: "Look for reusable past work",
          description: "Check the user's history for related analyses.",
          toolName: "existing_history_lookup",
          expectedOutput: "Matched history items and reuse suggestions.",
        },
        {
          title: "Create a reusable video prompt",
          description: "Turn the analysis into a clean, reusable production prompt.",
          toolName: "create_video_prompt",
          expectedOutput: "Main prompt, negative prompt, shot list and style notes.",
        },
        {
          title: "Save all deliverables",
          description: "Persist the analysis and prompt as artifacts.",
          toolName: "save_agent_artifact",
          expectedOutput: "Saved artifact references.",
        },
      ],
    },
    video_prompt_generation: {
      taskKind: "video_prompt_generation",
      steps: [
        {
          title: "Analyze the creative goal",
          description: "Extract product, audience, platform and visual direction from the request.",
          toolName: "analyze_prompt_goal",
          expectedOutput: "A structured creative brief.",
        },
        {
          title: "Research style references",
          description: "Search for current visual and prompt patterns that fit the brief.",
          toolName: "web_search_mock",
          expectedOutput: "Sources, keywords and style trends to inform the prompt.",
        },
        {
          title: "Look for reusable past work",
          description: "Check history for prompts that can be adapted.",
          toolName: "existing_history_lookup",
          expectedOutput: "Matched history items and reuse suggestions.",
        },
        {
          title: "Create the video prompt",
          description: "Generate a production-ready prompt with shot list and negatives.",
          toolName: "create_video_prompt",
          expectedOutput: "Main prompt, negative prompt, shot list and style notes.",
        },
        {
          title: "Suggest a production workflow",
          description: "Recommend settings and a workflow to produce the video from the prompt.",
          toolName: "suggest_video_workflow",
          expectedOutput: "Production steps, settings and platform advice.",
        },
        {
          title: "Save all deliverables",
          description: "Persist the prompt and workflow as artifacts.",
          toolName: "save_agent_artifact",
          expectedOutput: "Saved artifact references.",
        },
      ],
    },
    product_launch_video: {
      taskKind: "product_launch_video",
      steps: [
        {
          title: "Analyze the launch goal",
          description: "Extract product, audience, launch phase and key message.",
          toolName: "analyze_prompt_goal",
          expectedOutput: "A structured launch brief.",
        },
        {
          title: "Research launch creative patterns",
          description: "Search for high-performing launch video funnels and specs.",
          toolName: "web_search_mock",
          expectedOutput: "Sources, launch funnel patterns, specs and risks.",
        },
        {
          title: "Look for reusable past work",
          description: "Check history for past launch assets.",
          toolName: "existing_history_lookup",
          expectedOutput: "Matched history items and reuse suggestions.",
        },
        {
          title: "Synthesize a launch research report",
          description: "Combine findings into a launch strategy report.",
          toolName: "generate_research_report",
          expectedOutput: "Summary, funnel opportunities, angles and risks.",
        },
        {
          title: "Create the launch video prompt",
          description: "Write the hero launch video prompt and shot list.",
          toolName: "create_video_prompt",
          expectedOutput: "Main prompt, negative prompt, shot list and style notes.",
        },
        {
          title: "Assemble the launch workflow",
          description: "Plan teaser → hero → UGC → retargeting sequence with settings.",
          toolName: "suggest_video_workflow",
          expectedOutput: "Phased production steps, settings and platform advice.",
        },
        {
          title: "Save all deliverables",
          description: "Persist the report, prompt and launch workflow as artifacts.",
          toolName: "save_agent_artifact",
          expectedOutput: "Saved artifact references.",
        },
      ],
    },
    generic: {
      taskKind: "generic",
      steps: [
        {
          title: "Analyze the creative goal",
          description: "Understand the objective, audience and required assets.",
          toolName: "analyze_prompt_goal",
          expectedOutput: "A structured creative brief.",
        },
        {
          title: "Gather relevant context",
          description: "Search for relevant creative patterns and references.",
          toolName: "web_search_mock",
          expectedOutput: "Sources, keywords and insights.",
        },
        {
          title: "Look for reusable past work",
          description: "Check history for related assets.",
          toolName: "existing_history_lookup",
          expectedOutput: "Matched history items and reuse suggestions.",
        },
        {
          title: "Produce the deliverable",
          description: "Synthesize findings into a structured report.",
          toolName: "generate_research_report",
          expectedOutput: "A report with summary, opportunities and risk notes.",
        },
        {
          title: "Create a reusable video prompt",
          description: "Generate a ready-to-use video prompt.",
          toolName: "create_video_prompt",
          expectedOutput: "Main prompt, negative prompt, shot list and style notes.",
        },
        {
          title: "Save all deliverables",
          description: "Persist outputs as artifacts.",
          toolName: "save_agent_artifact",
          expectedOutput: "Saved artifact references.",
        },
      ],
    },
  };

  return plans[kind];
}

// ============ 入口 ============

export async function plan(input: PlannerInput): Promise<PlannerResult> {
  const hasMedia = input.attachments.length > 0;
  const taskKind = detectTaskKind(input.userGoal, hasMedia);

  // 1. 尝试 AI 规划
  const aiPlan = await planWithAI(input, taskKind);
  if (aiPlan) return aiPlan;

  // 2. Fallback
  const fb = fallbackPlan(taskKind, input);
  return { ...fb, usedFallback: true };
}

export { fallbackPlan as _fallbackPlanForTest, PlanSchema };
