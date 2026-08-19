/**
 * Agent Run 类型定义
 *
 * 这些类型同时被服务端（storage/planner/executor/tools）和客户端（UI 组件）使用，
 * 因此保持纯类型、不引入任何 node-only 依赖。
 */

// ============ 枚举 / 字面量类型 ============

export const AGENT_RUN_STATUSES = [
  "queued",
  "planning",
  "running",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_STEP_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number];

export const AGENT_TOOL_CALL_STATUSES = ["running", "completed", "failed"] as const;
export type AgentToolCallStatus = (typeof AGENT_TOOL_CALL_STATUSES)[number];

/**
 * Artifact 类型。前端按类型决定图标与展示方式。
 */
export const AGENT_ARTIFACT_TYPES = [
  "brief",
  "research_report",
  "video_prompt",
  "shot_list",
  "workflow",
  "risk_notes",
  "next_actions",
  "history_lookup",
  "summary",
  "other",
] as const;
export type AgentArtifactType = (typeof AGENT_ARTIFACT_TYPES)[number];

/** Planner 识别出的任务类别，用于选择不同的计划模板 */
export type AgentTaskKind =
  | "trend_research"
  | "video_analysis"
  | "video_prompt_generation"
  | "product_launch_video"
  | "competitor_breakdown"
  | "generic";

// ============ 实体类型 ============

export interface AgentAttachment {
  id: string;
  name: string;
  type: string; // mime type, e.g. "image/jpeg" / "video/mp4"
  size: number;
  /** 图片时可携带 data URL 供 mock 分析使用；视频通常只传元数据 */
  dataUrl?: string;
  /** 可选：客户端提取的视频帧（base64 data URL） */
  frames?: string[];
}

export interface AgentRun {
  id: string;
  userId: string;
  goal: string;
  status: AgentRunStatus;
  provider: string | null;
  locale: string;
  taskKind: AgentTaskKind | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  /** 附加信息：是否使用了 fallback planner、是否使用了 mock 工具等 */
  metadata: Record<string, unknown>;
  attachments: AgentAttachment[];
  /** 可恢复上下文：planner 产出的 brief、各步骤累积的中间产物摘要 */
  context: Record<string, unknown>;
}

export interface AgentStep {
  id: string;
  runId: string;
  order: number;
  title: string;
  description: string;
  status: AgentStepStatus;
  toolName: string | null;
  expectedOutput: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  outputSummary: string | null;
}

export interface AgentToolCall {
  id: string;
  runId: string;
  stepId: string;
  toolName: string;
  status: AgentToolCallStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface AgentArtifact {
  id: string;
  runId: string;
  type: AgentArtifactType;
  title: string;
  /** 结构化内容，前端按 type 渲染 */
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  favorite: boolean;
}

/** 一个 run 的完整详情（steps/toolCalls/artifacts 内嵌） */
export interface AgentRunDetail extends AgentRun {
  steps: AgentStep[];
  toolCalls: AgentToolCall[];
  artifacts: AgentArtifact[];
}

// ============ Planner / Tool / Executor 类型 ============

export interface PlannerInput {
  userGoal: string;
  locale: string;
  attachments: AgentAttachment[];
  availableTools: string[];
  provider: string | null;
  userId: string;
}

export interface AgentPlanStep {
  title: string;
  description: string;
  toolName: string;
  expectedOutput: string;
}

export interface PlannerResult {
  taskKind: AgentTaskKind;
  steps: AgentPlanStep[];
  /** true 表示使用了确定性 fallback 计划（无 API key 或 AI 调用失败） */
  usedFallback: boolean;
  /** AI planner 返回的原始文本（如有） */
  raw?: string;
}

export interface ToolContext {
  userId: string;
  runId: string;
  stepId: string;
  locale: string;
  attachments: AgentAttachment[];
  /** 跨步骤共享的可变上下文（planner brief、前序工具输出等） */
  sharedContext: Record<string, unknown>;
  /** 工具可通过此回调保存 artifact */
  saveArtifact: (artifact: Omit<AgentArtifact, "id" | "runId" | "createdAt" | "favorite">) => Promise<AgentArtifact>;
  /** 查询当前用户历史记录（由 storage 注入，避免工具直接依赖 db） */
  findHistory: (query: string, limit?: number) => Promise<Array<{ id: string; title: string; snippet: string; createdAt: string }>>;
  /** 信号：executor 是否请求取消/暂停 */
  isCancelled: () => boolean;
  /** 记录日志 */
  log: (message: string, data?: unknown) => void;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** 给 step.outputSummary 使用的一句话摘要 */
  summary?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** zod schema 或任何带 safeParse 的对象 */
  inputSchema: {
    safeParse(input: unknown): { success: boolean; error?: { errors?: Array<{ message: string }> }; data?: unknown };
  };
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

// ============ API 请求 / 响应类型 ============

export interface CreateRunInput {
  userGoal: string;
  attachments?: AgentAttachment[];
  provider?: string | null;
  locale?: string;
}

export interface AgentApiError {
  success: false;
  error: string;
  code?: string;
  retryAfter?: number;
}

export interface AgentApiSuccess<T> {
  success: true;
  data: T;
}

export type AgentApiResponse<T> = AgentApiSuccess<T> | AgentApiError;

export interface AgentListRunsResult {
  runs: Array<Pick<AgentRun, "id" | "goal" | "status" | "taskKind" | "createdAt" | "completedAt" | "errorMessage">>;
}
