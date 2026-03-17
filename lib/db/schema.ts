import {
  boolean,
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
