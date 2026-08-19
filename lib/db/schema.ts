import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ============ 复用 nano-video 的用户和认证表 ============
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  name: text("name"),
  image: text("image"),
  role: userRoleEnum("role").default("user").notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ============ 新增：用户 API Key 存储 ============
export const apiProviderEnum = pgEnum("api_provider", [
  "zhipu",   // 智谱AI
  "gemini",  // Google Gemini
  "openrouter", // OpenRouter
  "kie",     // Kie.ai 视频生成
]);

export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: apiProviderEnum("provider").notNull(),
    apiKey: text("api_key").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return {
      userIdIdx: index("idx_user_api_keys_user_id").on(table.userId),
      providerIdx: index("idx_user_api_keys_provider").on(table.provider),
    };
  }
);

// ============ 新增：分析历史记录 ============
export const mediaTypeEnum = pgEnum("media_type", ["video", "image"]);
export const analyzeModeEnum = pgEnum("analyze_mode", ["single", "batch"]);

export const analysisHistory = pgTable(
  "analysis_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mediaType: mediaTypeEnum("media_type").notNull(),
    mediaUrl: text("media_url"), // R2 中的文件路径
    mediaName: text("media_name"), // 原始文件名
    frameCount: integer("frame_count"),
    analyzeMode: analyzeModeEnum("analyze_mode").default("single"),
    prompt: text("prompt").notNull(), // 生成的完整提示词
    corePrompt: text("core_prompt"), // 核心提示词
    language: text("language").default("zh").notNull(), // AI 输出语言（zh/en）
    note: text("note"),
    tags: jsonb("tags").default([]).notNull(),
    favorite: boolean("favorite").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return {
      userIdIdx: index("idx_analysis_history_user_id").on(table.userId),
      createdAtIdx: index("idx_analysis_history_created_at").on(table.createdAt),
      favoriteIdx: index("idx_analysis_history_favorite").on(table.favorite),
    };
  }
);

// ============ 新增：操作日志 ============
export const logActionEnum = pgEnum("log_action", [
  "user.login",
  "user.logout",
  "file.upload",
  "file.delete",
  "analysis.start",
  "analysis.complete",
  "analysis.error",
  "history.create",
  "history.update",
  "history.delete",
  "settings.update",
  "admin.user_ban",
  "admin.user_unban",
  "video.edit.start",
  "video.edit.complete",
  "video.edit.error",
]);

export const operationLogs = pgTable(
  "operation_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    action: logActionEnum("action").notNull(),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata").default({}).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("idx_operation_logs_user_id").on(table.userId),
      actionIdx: index("idx_operation_logs_action").on(table.action),
      createdAtIdx: index("idx_operation_logs_created_at").on(table.createdAt),
    };
  }
);

// ============ 新增：音频分析记录 ============
export const audioAnalysis = pgTable(
  "audio_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mediaUrl: text("media_url").notNull(), // R2 中的文件路径
    mediaName: text("media_name"), // 原始文件名
    language: varchar("language", { length: 10 }), // 检测到的语言
    transcription: jsonb("transcription").default([]).notNull(), // Whisper 识别的完整文本（数组，含时间戳）
    segments: jsonb("segments").default([]).notNull(), // LLM 分段结果（数组，含 start/end/summary/tags）
    duration: integer("duration"), // 音频时长（秒）
    whisperModel: varchar("whisper_model", { length: 20 }).default("small"), // 使用的 Whisper 模型
    prompt: text("prompt"), // 用户自定义分析提示
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending/completed/error
    error: text("error"), // 错误信息
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return {
      userIdIdx: index("idx_audio_analysis_user_id").on(table.userId),
      createdAtIdx: index("idx_audio_analysis_created_at").on(table.createdAt),
      statusIdx: index("idx_audio_analysis_status").on(table.status),
    };
  }
);

// ============ 新增：视频剪辑记录 ============
export const videoClip = pgTable(
  "video_clip",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceMediaUrl: text("source_media_url").notNull(), // 原始视频 URL
    sourceMediaName: text("source_media_name"), // 原始文件名
    clipMediaUrl: text("clip_media_url"), // 剪辑后的视频 URL（R2）
    segments: jsonb("segments").default([]).notNull(), // 剪辑的片段（数组，含 start/end）
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending/processing/completed/error
    error: text("error"), // 错误信息
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return {
      userIdIdx: index("idx_video_clip_user_id").on(table.userId),
      createdAtIdx: index("idx_video_clip_created_at").on(table.createdAt),
    };
  }
);

// ============ 新增：视频生成记录 ============
export const videoGeneration = pgTable(
  "video_generation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().unique(),
    projectId: uuid("project_id"),
    sceneId: uuid("scene_id"),
    projectVersionId: uuid("project_version_id"),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    duration: integer("duration"),
    resolution: varchar("resolution", { length: 20 }),
    model: varchar("model", { length: 100 }),
    provider: varchar("provider", { length: 20 }).default("kie").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    progress: varchar("progress", { length: 50 }),
    videoUrl: text("video_url"),
    error: text("error"),
    rawResponse: jsonb("raw_response").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return {
      userIdIdx: index("idx_video_generation_user_id").on(table.userId),
      taskIdIdx: index("idx_video_generation_task_id").on(table.taskId),
      projectIdIdx: index("idx_video_generation_project_id").on(table.projectId),
      sceneIdIdx: index("idx_video_generation_scene_id").on(table.sceneId),
      projectVersionIdIdx: index("idx_video_generation_project_version_id").on(table.projectVersionId),
      statusIdx: index("idx_video_generation_status").on(table.status),
      createdAtIdx: index("idx_video_generation_created_at").on(table.createdAt),
    };
  }
);

// ============ 新增：Agentic Workflow (Create with Agent) ============

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "planning",
  "running",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);

export const agentStepStatusEnum = pgEnum("agent_step_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export const agentToolCallStatusEnum = pgEnum("agent_tool_call_status", [
  "running",
  "completed",
  "failed",
]);

export const agentArtifactTypeEnum = pgEnum("agent_artifact_type", [
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
]);

export const agentTaskKindEnum = pgEnum("agent_task_kind", [
  "trend_research",
  "video_analysis",
  "video_prompt_generation",
  "product_launch_video",
  "competitor_breakdown",
  "generic",
]);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    status: agentRunStatusEnum("status").default("queued").notNull(),
    provider: text("provider"),
    locale: varchar("locale", { length: 10 }).default("en").notNull(),
    taskKind: agentTaskKindEnum("task_kind"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}).notNull(),
    attachments: jsonb("attachments").default([]).notNull(),
    context: jsonb("context").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("idx_agent_runs_user_id").on(table.userId),
    statusIdx: index("idx_agent_runs_status").on(table.status),
    createdAtIdx: index("idx_agent_runs_created_at").on(table.createdAt),
  })
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: agentStepStatusEnum("status").default("queued").notNull(),
    toolName: text("tool_name"),
    expectedOutput: text("expected_output"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    outputSummary: text("output_summary"),
  },
  (table) => ({
    runIdIdx: index("idx_agent_steps_run_id").on(table.runId),
    orderIdx: index("idx_agent_steps_order").on(table.order),
  })
);

export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => agentSteps.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    status: agentToolCallStatusEnum("status").default("running").notNull(),
    input: jsonb("input").default({}).notNull(),
    output: jsonb("output"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (table) => ({
    runIdIdx: index("idx_agent_tool_calls_run_id").on(table.runId),
    stepIdIdx: index("idx_agent_tool_calls_step_id").on(table.stepId),
  })
);

export const agentArtifacts = pgTable(
  "agent_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    type: agentArtifactTypeEnum("type").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").default({}).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    favorite: boolean("favorite").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdIdx: index("idx_agent_artifacts_run_id").on(table.runId),
    typeIdx: index("idx_agent_artifacts_type").on(table.type),
    favoriteIdx: index("idx_agent_artifacts_favorite").on(table.favorite),
  })
);

// ============ V2: Project Workflow / Video Blueprint ============
export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "analyzing",
  "ready",
  "failed",
  "archived",
]);

export const projectVersionKindEnum = pgEnum("project_version_kind", [
  "original",
  "remix",
]);

export const workflowJobStatusEnum = pgEnum("workflow_job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const workflowJobTypeEnum = pgEnum("workflow_job_type", [
  "ANALYZE_VIDEO",
  "SPLIT_VIDEO",
  "ANALYZE_SCENE",
  "GENERATE_VIDEO",
  "GENERATE_AUDIO",
  "RENDER_VIDEO",
  "REMIX_VIDEO",
]);

export const projectAssetTypeEnum = pgEnum("project_asset_type", [
  "reference_video",
  "scene_clip",
  "keyframe",
  "audio",
  "generated_video",
  "voice",
  "subtitle",
  "final_video",
  "image",
  "other",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").default("draft").notNull(),
    activeVersionId: uuid("active_version_id"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("idx_projects_user_id").on(table.userId),
    statusIdx: index("idx_projects_status").on(table.status),
    createdAtIdx: index("idx_projects_created_at").on(table.createdAt),
  })
);

export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentVersionId: uuid("parent_version_id"),
    versionNumber: integer("version_number").notNull(),
    kind: projectVersionKindEnum("kind").default("original").notNull(),
    label: text("label").notNull(),
    remixPrompt: text("remix_prompt"),
    overview: jsonb("overview").default({}).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectIdIdx: index("idx_project_versions_project_id").on(table.projectId),
    kindIdx: index("idx_project_versions_kind").on(table.kind),
  })
);

export const referenceVideos = pgTable(
  "reference_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    duration: integer("duration"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdIdx: index("idx_reference_videos_project_id").on(table.projectId),
  })
);

export const videoScenes = pgTable(
  "video_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referenceVideoId: uuid("reference_video_id")
      .references(() => referenceVideos.id, { onDelete: "set null" }),
    sceneIndex: integer("scene_index").notNull(),
    shotGroupId: text("shot_group_id"),
    startTime: doublePrecision("start_time").notNull(),
    endTime: doublePrecision("end_time").notNull(),
    duration: doublePrecision("duration").notNull(),
    clipUrl: text("clip_url"),
    keyframeUrls: jsonb("keyframe_urls").default([]).notNull(),
    audioUrl: text("audio_url"),
    transitionIn: text("transition_in"),
    transitionOut: text("transition_out"),
    status: workflowJobStatusEnum("status").default("queued").notNull(),
    error: text("error"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectIdIdx: index("idx_video_scenes_project_id").on(table.projectId),
    referenceVideoIdIdx: index("idx_video_scenes_reference_video_id").on(table.referenceVideoId),
    sceneIndexIdx: index("idx_video_scenes_scene_index").on(table.sceneIndex),
  })
);

export const sceneVersions = pgTable(
  "scene_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectVersionId: uuid("project_version_id")
      .notNull()
      .references(() => projectVersions.id, { onDelete: "cascade" }),
    originalSceneId: uuid("original_scene_id")
      .notNull()
      .references(() => videoScenes.id, { onDelete: "cascade" }),
    sceneIndex: integer("scene_index").notNull(),
    story: jsonb("story").default({}).notNull(),
    visual: jsonb("visual").default({}).notNull(),
    dialogue: jsonb("dialogue").default([]).notNull(),
    narration: jsonb("narration").default([]).notNull(),
    subtitle: jsonb("subtitle").default([]).notNull(),
    audio: jsonb("audio").default({}).notNull(),
    transition: jsonb("transition").default({}).notNull(),
    generationPrompt: text("generation_prompt").notNull(),
    duration: doublePrecision("duration").notNull(),
    generatedVideoUrl: text("generated_video_url"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectIdIdx: index("idx_scene_versions_project_id").on(table.projectId),
    projectVersionIdIdx: index("idx_scene_versions_project_version_id").on(table.projectVersionId),
    originalSceneIdIdx: index("idx_scene_versions_original_scene_id").on(table.originalSceneId),
  })
);

export const workflowJobs = pgTable(
  "workflow_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => videoScenes.id, { onDelete: "set null" }),
    type: workflowJobTypeEnum("type").notNull(),
    status: workflowJobStatusEnum("status").default("queued").notNull(),
    provider: text("provider"),
    modelId: text("model_id"),
    externalTaskId: text("external_task_id"),
    resultUrl: text("result_url"),
    error: text("error"),
    input: jsonb("input").default({}).notNull(),
    output: jsonb("output").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdIdx: index("idx_workflow_jobs_project_id").on(table.projectId),
    sceneIdIdx: index("idx_workflow_jobs_scene_id").on(table.sceneId),
    statusIdx: index("idx_workflow_jobs_status").on(table.status),
    typeIdx: index("idx_workflow_jobs_type").on(table.type),
  })
);

export const projectAssets = pgTable(
  "project_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => videoScenes.id, { onDelete: "set null" }),
    type: projectAssetTypeEnum("type").notNull(),
    url: text("url").notNull(),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    size: integer("size"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdIdx: index("idx_project_assets_project_id").on(table.projectId),
    sceneIdIdx: index("idx_project_assets_scene_id").on(table.sceneId),
    typeIdx: index("idx_project_assets_type").on(table.type),
  })
);
// ============ 类型导出 ============
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type UserApiKey = typeof userApiKeys.$inferSelect;
export type NewUserApiKey = typeof userApiKeys.$inferInsert;
export type AnalysisHistory = typeof analysisHistory.$inferSelect;
export type NewAnalysisHistory = typeof analysisHistory.$inferInsert;
export type OperationLog = typeof operationLogs.$inferSelect;
export type NewOperationLog = typeof operationLogs.$inferInsert;
export type AudioAnalysis = typeof audioAnalysis.$inferSelect;
export type NewAudioAnalysis = typeof audioAnalysis.$inferInsert;
export type VideoClip = typeof videoClip.$inferSelect;
export type NewVideoClip = typeof videoClip.$inferInsert;
export type VideoGeneration = typeof videoGeneration.$inferSelect;
export type NewVideoGeneration = typeof videoGeneration.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentStep = typeof agentSteps.$inferSelect;
export type NewAgentStep = typeof agentSteps.$inferInsert;
export type AgentToolCall = typeof agentToolCalls.$inferSelect;
export type NewAgentToolCall = typeof agentToolCalls.$inferInsert;
export type AgentArtifact = typeof agentArtifacts.$inferSelect;
export type NewAgentArtifact = typeof agentArtifacts.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectVersion = typeof projectVersions.$inferSelect;
export type NewProjectVersion = typeof projectVersions.$inferInsert;
export type ReferenceVideo = typeof referenceVideos.$inferSelect;
export type NewReferenceVideo = typeof referenceVideos.$inferInsert;
export type VideoScene = typeof videoScenes.$inferSelect;
export type NewVideoScene = typeof videoScenes.$inferInsert;
export type SceneVersion = typeof sceneVersions.$inferSelect;
export type NewSceneVersion = typeof sceneVersions.$inferInsert;
export type WorkflowJob = typeof workflowJobs.$inferSelect;
export type NewWorkflowJob = typeof workflowJobs.$inferInsert;
export type ProjectAsset = typeof projectAssets.$inferSelect;
export type NewProjectAsset = typeof projectAssets.$inferInsert;
