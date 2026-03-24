# Prompt Analyzer 项目 - 从零到英雄学习指南

> 本文档是 prompt-analyzer（视频提示词分析工具）的核心技术学习文档，手把手带你掌握核心知识点。
> 跟着敲代码，验证输出，真正理解每个概念。

---

## 目录

1. [项目初始化与开发环境](#1-项目初始化与开发环境)
2. [TypeScript 类型系统](#2-typescript-类型系统)
3. [Next.js 15 App Router 基础](#3-nextjs-15-app-router-基础)
4. [API 路由与请求处理](#4-api-路由与请求处理)
5. [数据库操作 - Drizzle ORM](#5-数据库操作---drizzle-orm)
6. [认证系统 - Better-Auth](#6-认证系统---better-auth)
7. [文件上传与处理](#7-文件上传与处理)
8. [Cloudflare R2 存储](#8-cloudflare-r2-存储)
9. [FFmpeg 视频处理](#9-ffmpeg-视频处理)
10. [AI 集成 - 多提供商](#10-ai-集成---多提供商)
11. [实战：完整分析流程](#11-实战完整分析流程)

---

## 1. 项目初始化与开发环境

### 1.1 技术栈概览

```
Next.js 15 + React 19 + TypeScript
├── 数据库: Supabase PostgreSQL + Drizzle ORM
├── 认证: Better-Auth (Google/GitHub 登录)
├── 存储: Cloudflare R2 (S3 兼容)
├── 视频处理: FFmpeg
└── AI: 智谱AI / Gemini / OpenRouter
```

### 1.2 跟着敲 - 环境准备

```bash
# 1. 安装 pnpm (如果没有)
npm install -g pnpm

# 2. 克隆项目
git clone https://github.com/raojiacui/prompt-lens.git
cd prompt-lens

# 3. 安装依赖
pnpm install

# 4. 复制环境变量模板
cp .env.example .env

# 5. 启动开发服务器
pnpm dev
```

### 1.3 环境变量配置 (.env)

```bash
# ==================== 数据库 ====================
DATABASE_URL=postgres://user:password@host:5432/dbname

# ==================== 认证 ====================
BETTER_AUTH_SECRET=your-secret-key-min-32-chars
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# ==================== R2 存储 ====================
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=prompt-analyzer
R2_PUBLIC_URL=https://cdn.yourdomain.com

# ==================== AI (可选) ====================
GEMINI_API_KEY=xxx
DEEPSEEK_API_KEY=xxx
OPENROUTER_API_KEY=xxx

# ==================== 站点 ====================
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ADMIN_EMAILS=admin@example.com
```

### 1.4 预期输出

```bash
$ pnpm dev

▲ Next.js 15.1.0
- Local: http://localhost:3000
- Network: http://192.168.x.x:3000

✓ Ready in 2.5s
```

---

## 2. TypeScript 类型系统

### 2.1 核心概念

prompt-analyzer 项目大量使用 TypeScript 类型来确保代码健壮性。

### 2.2 跟着敲 - 类型定义

```typescript
// ===== 文件: lib/ts-basics.ts =====

// 1. 基础类型
let name: string = "prompt-analyzer";
let count: number = 42;
let isActive: boolean = true;

// 2. 数组类型
let tags: string[] = ["video", "ai", "analysis"];
let counts: Array<number> = [1, 2, 3];

// 3. 对象类型 - 接口
interface User {
  id: string;
  email: string;
  name?: string;  // 可选属性
  role: "user" | "admin";
}

const user: User = {
  id: "123",
  email: "test@example.com",
  role: "user"
};

// 4. 函数类型
type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

// 使用泛型
function createResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

const response = createResponse({ token: "abc" });
// response: { success: true, data: { token: string } }

// 5. 枚举类型
enum MediaType {
  Video = "video",
  Image = "image"
}

// 6. 联合类型
type Provider = "zhipu" | "gemini" | "openrouter";

// 7. 类型守卫
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function process(value: unknown) {
  if (isString(value)) {
    // 这里 TypeScript 知道 value 是 string
    console.log(value.toUpperCase());
  }
}
```

### 2.3 预期输出

```typescript
// 运行上述代码，验证类型推断

// 1. 基本类型
name = "prompt-analyzer"  // ✓
count = 100               // ✓

// 2. 泛型类型推断
response.data?.token      // ✓ string | undefined

// 3. 联合类型字面量
const provider: Provider = "zhipu"  // ✓
const invalid: Provider = "openai" // ✗ 编译错误!
```

---

## 3. Next.js 15 App Router 基础

### 3.1 核心概念

Next.js 15 使用 **App Router** (文件系统的路由)，基于 React Server Components (RSC)。

### 3.2 跟着敲 - 页面与布局

```typescript
// ===== 文件: app/layout.tsx =====

import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prompt Analyzer",
  description: "AI 视频提示词分析工具",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
```

```typescript
// ===== 文件: app/page.tsx =====

// 默认是 Server Component (无需 'use client')
export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-bold">
        Welcome to Prompt Analyzer
      </h1>
    </main>
  );
}
```

### 3.3 跟着敲 - 客户端组件

```typescript
// ===== 文件: components/Counter.tsx =====

'use client';  // 必须声明!

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-4 border rounded">
      <p>Count: {count}</p>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Increment
      </button>
    </div>
  );
}
```

### 3.4 预期输出

访问 `http://localhost:3000`：
- 首页显示 "Welcome to Prompt Analyzer"
- 点击 Increment 按钮，计数增加

---

## 4. API 路由与请求处理

### 4.1 核心概念

在 Next.js App Router 中，API 路由位于 `app/api/` 目录下：
- `route.ts` 文件处理请求
- 支持 GET、POST、PUT、DELETE 等方法

### 4.2 跟着敲 - GET 请求

```typescript
// ===== 文件: app/api/hello/route.ts =====

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name") || "World";

  return NextResponse.json({
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
  });
}
```

### 4.3 跟着敲 - POST 请求 + JSON Body

```typescript
// ===== 文件: app/api/echo/route.ts =====

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // 解析 JSON body
    const body = await request.json();

    // 也可以获取 headers
    const contentType = request.headers.get("content-type");

    return NextResponse.json({
      received: body,
      contentType,
      success: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }
}
```

### 4.4 跟着敲 - FormData 上传处理

```typescript
// ===== 文件: app/api/upload/route.ts =====

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // 1. 解析 FormData
  const formData = await request.formData();

  // 2. 获取文件
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json(
      { error: "No file provided" },
      { status: 400 }
    );
  }

  // 3. 获取其他字段
  const type = formData.get("type") as string;

  // 4. 读取文件内容
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  console.log(`File: ${file.name}, Size: ${buffer.length}, Type: ${type}`);

  // 5. 返回结果
  return NextResponse.json({
    success: true,
    filename: file.name,
    size: buffer.length,
    type,
  });
}
```

### 4.5 测试方法

```bash
# 测试 GET
curl "http://localhost:3000/api/hello?name=Prompt"

# 测试 POST JSON
curl -X POST http://localhost:3000/api/echo \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","count":42}'

# 测试 FormData
curl -X POST http://localhost:3000/api/upload \
  -F "file=@test.mp4" \
  -F "type=video"
```

### 4.6 预期输出

```json
// GET /api/hello?name=Prompt
{
  "message": "Hello, Prompt!",
  "timestamp": "2024-01-15T10:30:00.000Z"
}

// POST /api/echo
{
  "received": {"message": "hello", "count": 42},
  "contentType": "application/json",
  "success": true
}

// POST /api/upload
{
  "success": true,
  "filename": "test.mp4",
  "size": 1048576,
  "type": "video"
}
```

---

## 5. 数据库操作 - Drizzle ORM

### 5.1 核心概念

Drizzle ORM 是轻量级 ORM，直接用 SQL 语法，零抽象。

### 5.2 跟着敲 - Schema 定义

```typescript
// ===== 文件: lib/db/schema.ts =====

import {
  pgTable,       // PostgreSQL 表
  uuid,          // UUID 类型
  text,          // 文本类型
  varchar,       // 可变字符串
  integer,       // 整数
  boolean,       // 布尔
  timestamp,     // 时间戳
  jsonb,         // JSON 类型
  pgEnum,        // 枚举
  index,         // 索引
} from "drizzle-orm/pg-core";

// 1. 定义枚举
export const mediaTypeEnum = pgEnum("media_type", ["video", "image"]);

// 2. 定义用户表
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  name: text("name"),
  role: varchar("role", { length: 20 }).default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 3. 定义分析历史表 (带索引)
export const analysisHistory = pgTable(
  "analysis_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mediaType: mediaTypeEnum("media_type").notNull(),
    mediaUrl: text("media_url"),
    prompt: text("prompt").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // 索引定义
    userIdIdx: index("idx_analysis_history_user_id").on(table.userId),
    createdAtIdx: index("idx_analysis_history_created_at").on(table.createdAt),
  })
);

// 4. 导出类型
export type AnalysisHistory = typeof analysisHistory.$inferSelect;
export type NewAnalysisHistory = typeof analysisHistory.$inferInsert;
```

### 5.3 跟着敲 - 数据库连接

```typescript
// ===== 文件: lib/db/index.ts =====

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// 创建 PostgreSQL 客户端
const client = postgres(connectionString, { max: 1 });

// 创建 Drizzle 实例
export const db = drizzle(client, { schema });

// 导出所有 schema
export * from "./schema";
```

### 5.4 跟着敲 - CRUD 操作

```typescript
// ===== 文件: lib/db/queries.ts =====

import { db } from "./index";
import { user, analysisHistory } from "./schema";
import { eq, desc, and } from "drizzle-orm";

// ===== 插入数据 =====
async function createAnalysis() {
  const result = await db.insert(analysisHistory).values({
    userId: "550e8400-e29b-41d4-a716-446655440000",
    mediaType: "video",
    mediaUrl: "https://cdn.example.com/video.mp4",
    prompt: "A beautiful sunset over the ocean",
  }).returning();

  console.log("Created:", result[0].id);
  return result[0];
}

// ===== 查询数据 =====
async function getUserHistory(userId: string) {
  const results = await db.query.analysisHistory.findMany({
    where: eq(analysisHistory.userId, userId),
    orderBy: [desc(analysisHistory.createdAt)],
    limit: 10,
  });

  console.log("Found:", results.length, "records");
  return results;
}

// ===== 更新数据 =====
async function updateAnalysis(id: string, prompt: string) {
  const result = await db.update(analysisHistory)
    .set({ prompt, updatedAt: new Date() })
    .where(eq(analysisHistory.id, id))
    .returning();

  return result[0];
}

// ===== 删除数据 =====
async function deleteAnalysis(id: string) {
  await db.delete(analysisHistory)
    .where(eq(analysisHistory.id, id));
}

// ===== 条件查询 =====
async function getVideoHistory(userId: string, limit: number) {
  const results = await db.query.analysisHistory.findMany({
    where: and(
      eq(analysisHistory.userId, userId),
      eq(analysisHistory.mediaType, "video")
    ),
    orderBy: [desc(analysisHistory.createdAt)],
    limit,
  });

  return results;
}
```

### 5.5 跟着敲 - 运行迁移

```bash
# 生成迁移文件
pnpm db:generate

# 执行迁移
pnpm db:migrate

# 或推送 schema (开发时)
pnpm db:push
```

### 5.6 预期输出

```sql
-- 生成的 SQL (drizzle/0000_initial.sql)

CREATE TABLE "user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text UNIQUE NOT NULL,
  "name" text,
  "role" varchar(20) DEFAULT 'user' NOT NULL,
  "created_at" timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE "analysis_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "media_type" "media_type" NOT NULL,
  "media_url" text,
  "prompt" text NOT NULL,
  "created_at" timestamp DEFAULT NOW() NOT NULL
);

CREATE INDEX "idx_analysis_history_user_id" ON "analysis_history"("user_id");
CREATE INDEX "idx_analysis_history_created_at" ON "analysis_history"("created_at");
```

---

## 6. 认证系统 - Better-Auth

### 6.1 核心概念

Better-Auth 是现代化的认证库，支持多种登录方式，自动处理 Session。

### 6.2 跟着敲 - Auth 配置

```typescript
// ===== 文件: lib/auth/index.ts =====

import { db } from "@/lib/db";
import { account, session, user, verification } from "@/lib/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous } from "better-auth/plugins";

export const auth = betterAuth({
  appName: "Prompt Analyzer",
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  // Session 配置
  session: {
    expiresIn: 60 * 60 * 24 * 7,  // 7 天
    updateAge: 60 * 60 * 24,       // 24 小时更新
    freshAge: 60 * 5,              // 5 分钟内认为 fresh
  },

  // 数据库适配器
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: user,
      session: session,
      account: account,
      verification: verification,
    },
  }),

  // 社交登录
  socialProviders: {
    github: {
      clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  // 插件
  plugins: [
    anonymous(),    // 匿名用户支持
    admin(),        // 管理员功能
    nextCookies(),  // Next.js Cookie 支持
  ],
});
```

### 6.3 跟着敲 - API 路由中使用认证

```typescript
// ===== 文件: app/api/protected/route.ts =====

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 1. 获取 Session
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  // 2. 检查是否登录
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 3. 返回用户信息
  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
  });
}
```

### 6.4 跟着敲 - 客户端使用认证

```typescript
// ===== 文件: components/AuthButton.tsx =====

'use client';

import { useSession, signIn, signOut } from "next-auth/react";

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <span>Loading...</span>;
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-4">
        <img
          src={session.user.image || "/default-avatar.png"}
          alt={session.user.name || "User"}
          className="w-8 h-8 rounded-full"
        />
        <span>{session.user.email}</span>
        <button
          onClick={() => signOut()}
          className="px-4 py-2 bg-red-500 text-white rounded"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      className="px-4 py-2 bg-blue-500 text-white rounded"
    >
      Sign In with Google
    </button>
  );
}
```

### 6.5 预期输出

```
# 访问受保护的 API (未登录)
curl http://localhost:3000/api/protected

{
  "error": "Unauthorized"
}

# 登录后访问
curl -H "Cookie: better-auth.session_token=xxx" \
  http://localhost:3000/api/protected

{
  "user": {
    "id": "550e8400-...",
    "email": "user@example.com",
    "name": "John Doe",
    "image": "https://..."
  }
}
```

---

## 7. 文件上传与处理

### 7.1 核心概念

使用 FormData 处理文件上传，支持本地存储和云存储（R2）。

### 7.2 跟着敲 - 完整上传 API

```typescript
// ===== 文件: app/api/upload/route.ts =====

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    // 1. 认证检查
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. 解析 FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // 3. 验证文件类型
    const allowedTypes = ["video/", "image/"];
    const isValidType = allowedTypes.some(type =>
      file.type.startsWith(type)
    );

    if (!isValidType) {
      return NextResponse.json(
        { error: "Invalid file type" },
        { status: 400 }
      );
    }

    // 4. 验证文件大小 (100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large (max 100MB)" },
        { status: 400 }
      );
    }

    // 5. 生成唯一文件名
    const ext = file.name.split(".").pop();
    const uniqueName = `${randomUUID()}.${ext}`;

    // 6. 创建上传目录
    const uploadDir = path.join(
      process.cwd(),
      "temp_uploads",
      session.user.id
    );
    await mkdir(uploadDir, { recursive: true });

    // 7. 保存文件
    const filePath = path.join(uploadDir, uniqueName);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // 8. 返回文件 URL
    const fileUrl = `/temp_uploads/${session.user.id}/${uniqueName}`;

    return NextResponse.json({
      success: true,
      url: fileUrl,
      filename: file.name,
      size: file.size,
      type: file.type,
    });

  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
```

### 7.3 跟着敲 - 客户端上传组件

```typescript
// ===== 文件: components/FileUploader.tsx =====

'use client';

import { useState, useRef } from "react";

export function FileUploader() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      setResult(data);

      if (!response.ok) {
        throw new Error(data.error);
      }
    } catch (error: any) {
      setResult({ error: error.message });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-4 border rounded-lg">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        className="mb-4"
      />
      <button
        onClick={handleUpload}
        disabled={uploading}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>

      {result && (
        <pre className="mt-4 p-2 bg-gray-100 rounded overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

### 7.4 预期输出

```json
// 上传成功
{
  "success": true,
  "url": "/temp_uploads/550e8400-.../abc123.mp4",
  "filename": "my-video.mp4",
  "size": 5242880,
  "type": "video/mp4"
}

// 上传失败 - 文件太大
{
  "error": "File too large (max 100MB)"
}
```

---

## 8. Cloudflare R2 存储

### 8.1 核心概念

R2 是 S3 兼容的对象存储，无流量费用。使用 `@aws-sdk/client-s3` 操作。

### 8.2 跟着敲 - R2 客户端配置

```typescript
// ===== 文件: lib/cloudflare/r2.ts =====

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

// R2 配置
const r2Config = {
  region: process.env.R2_REGION || "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
};

const bucketName = process.env.R2_BUCKET_NAME!;
const publicUrl = process.env.R2_PUBLIC_URL!;

// 创建 S3 客户端
const s3Client = new S3Client(r2Config);
```

### 8.3 跟着敲 - 上传文件

```typescript
// ===== 继续文件: lib/cloudflare/r2.ts =====

/**
 * 上传文件到 R2
 */
export async function uploadToR2(
  file: Buffer | string,
  key: string,
  contentType: string
): Promise<string> {
  try {
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: bucketName,
        Key: key,
        Body: file,
        ContentType: contentType,
      },
    });

    await upload.done();

    // 返回公开访问 URL
    return `${publicUrl}/${key}`;
  } catch (error) {
    console.error("R2 upload error:", error);
    throw new Error("Failed to upload file");
  }
}

/**
 * 生成用户文件路径
 */
export function generateUserFilePath(
  userId: string,
  filename: string,
  type: "video" | "image"
): string {
  const ext = filename.split(".").pop();
  const uniqueName = `${crypto.randomUUID()}.${ext}`;
  return `users/${userId}/${type}/${uniqueName}`;
}
```

### 8.4 跟着敲 - 下载文件

```typescript
// ===== 继续文件: lib/cloudflare/r2.ts =====

/**
 * 从 R2 下载文件
 */
export async function getFromR2(key: string): Promise<Buffer> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    // 将流转换为 Buffer
    const stream = response.Body as any;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  } catch (error) {
    console.error("R2 get error:", error);
    throw new Error("Failed to get file");
  }
}
```

### 8.5 跟着敲 - 删除文件

```typescript
// ===== 继续文件: lib/cloudflare/r2.ts =====

/**
 * 从 R2 删除文件
 */
export async function deleteFromR2(key: string): Promise<void> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } catch (error) {
    console.error("R2 delete error:", error);
    throw new Error("Failed to delete file");
  }
}
```

### 8.6 预期输出

```typescript
// 使用示例
const key = generateUserFilePath(
  "550e8400-...",
  "video.mp4",
  "video"
);
// key: "users/550e8400-.../video/abc123-def456.mp4"

const url = await uploadToR2(
  fileBuffer,
  key,
  "video/mp4"
);
// url: "https://cdn.example.com/users/550e8400-.../video/abc123-def456.mp4"
```

---

## 9. FFmpeg 视频处理

### 9.1 核心概念

使用 `fluent-ffmpeg` 库处理视频：提取帧、获取视频信息、剪辑等。

### 9.2 跟着敲 - 获取视频信息

```typescript
// ===== 文件: lib/video-processor/index.ts =====

import ffmpeg from "fluent-ffmpeg";
import path from "path";

// 设置 FFmpeg 路径 (Windows)
const ffmpegPath = path.join(
  process.cwd(),
  "node_modules",
  ".pnpm",
  "@ffmpeg-installer+win32-x64@4.1.0",
  "node_modules",
  "@ffmpeg-installer",
  "win32-x64",
  "ffmpeg.exe"
);
ffmpeg.setFfmpegPath(ffmpegPath);

export interface VideoInfo {
  duration: number;    // 时长 (秒)
  width: number;       // 宽度
  height: number;     // 高度
  fps: number;        // 帧率
  codec: string;      // 编码格式
}

/**
 * 获取视频信息
 */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(
        (s) => s.codec_type === "video"
      );

      if (!videoStream) {
        reject(new Error("No video stream found"));
        return;
      }

      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: Number(eval(videoStream.r_frame_rate || "30")) || 30,
        codec: videoStream.codec_name || "unknown",
      });
    });
  });
}
```

### 9.3 跟着敲 - 提取视频帧

```typescript
// ===== 继续文件: lib/video-processor/index.ts =====

import fs from "fs/promises";

export interface FrameExtractionResult {
  framePath: string;
  frameIndex: number;
  timestamp: number;
}

/**
 * 从视频中提取帧
 */
export async function extractFrames(
  videoPath: string,
  frameCount: number = 8,
  outputDir?: string
): Promise<FrameExtractionResult[]> {
  // 1. 获取视频信息
  const videoInfo = await getVideoInfo(videoPath);

  // 2. 创建输出目录
  if (!outputDir) {
    outputDir = path.join(process.cwd(), "temp_frames", crypto.randomUUID());
  }
  await fs.mkdir(outputDir, { recursive: true });

  // 3. 计算提取时间点 (均匀分布)
  const interval = videoInfo.duration / (frameCount + 1);
  const timestamps: number[] = [];
  for (let i = 1; i <= frameCount; i++) {
    timestamps.push(interval * i);
  }

  const results: FrameExtractionResult[] = [];

  // 4. 逐帧提取
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const outputPath = path.join(
      outputDir,
      `frame_${i.toString().padStart(3, "0")}.jpg`
    );

    await extractSingleFrame(videoPath, outputPath, timestamp);

    results.push({
      framePath: outputPath,
      frameIndex: i,
      timestamp,
    });
  }

  return results;
}

/**
 * 提取单帧
 */
function extractSingleFrame(
  videoPath: string,
  outputPath: string,
  timestamp: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath)
      .outputOptions(["-q:v 2"]) // 高质量 JPEG
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
```

### 9.4 跟着敲 - 帧转 Base64

```typescript
// ===== 继续文件: lib/video-processor/index.ts =====

/**
 * 单帧转 Base64
 */
export async function frameToBase64(framePath: string): Promise<string> {
  const buffer = await fs.readFile(framePath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/**
 * 批量帧转 Base64
 */
export async function framesToBase64(
  frames: FrameExtractionResult[]
): Promise<string[]> {
  const base64Frames: string[] = [];

  for (const frame of frames) {
    const base64 = await frameToBase64(frame.framePath);
    base64Frames.push(base64);
  }

  return base64Frames;
}

/**
 * 清理临时文件
 */
export async function cleanupTempFiles(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn("Failed to cleanup temp files:", error);
  }
}
```

### 9.5 预期输出

```typescript
// 获取视频信息
const info = await getVideoInfo("video.mp4");
console.log(info);
// {
//   duration: 10.5,
//   width: 1920,
//   height: 1080,
//   fps: 30,
//   codec: "h264"
// }

// 提取 8 帧
const frames = await extractFrames("video.mp4", 8);
console.log(frames);
// [
//   { framePath: ".../frame_000.jpg", frameIndex: 0, timestamp: 1.05 },
//   { framePath: ".../frame_001.jpg", frameIndex: 1, timestamp: 2.1 },
//   ...
// ]

// 转换为 base64
const base64Frames = await framesToBase64(frames);
console.log(base64Frames[0].substring(0, 50));
// "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
```

---

## 10. AI 集成 - 多提供商

### 10.1 核心概念

项目支持三种 AI 提供商：智谱AI (zhipu)、Gemini、OpenRouter。通过统一的接口调用不同的 API。

### 10.2 跟着敲 - API 配置

```typescript
// ===== 文件: lib/ai/analyzer.ts =====

import axios from "axios";

// API 配置
const API_CONFIGS = {
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4v-plus",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
    model: "gemini-2.0-flash-exp",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-3-haiku",
  },
};

// 类型定义
export type ApiProvider = "zhipu" | "gemini" | "openrouter";

export interface AnalyzeOptions {
  userId: string;
  provider?: ApiProvider;
  frames: string[];  // base64 图片数组
  mode: "single" | "batch";
}

export interface AnalyzeResult {
  success: boolean;
  prompt?: string;
  corePrompt?: string;
  error?: string;
}
```

### 10.3 跟着敲 - 智谱AI API 调用

```typescript
// ===== 继续文件: lib/ai/analyzer.ts =====

/**
 * 调用智谱AI API
 */
async function callZhipuApi(
  apiKey: string,
  messages: any[]
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const payload = {
    model: API_CONFIGS.zhipu.model,
    messages: messages,
    max_tokens: 4096,
    temperature: 0.7,
  };

  const response = await axios.post(API_CONFIGS.zhipu.url, payload, {
    headers,
    timeout: 180000,  // 3 分钟超时
  });

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}
```

### 10.4 跟着敲 - Gemini API 调用

```typescript
// ===== 继续文件: lib/ai/analyzer.ts =====

/**
 * 调用 Gemini API
 */
async function callGeminiApi(
  apiKey: string,
  images: string[],
  textPrompt: string
): Promise<string> {
  const contents = [];

  for (const img of images) {
    contents.push({
      role: "user",
      parts: [
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: img.split(",")[1],  // 去掉 data:image/jpeg;base64,
          },
        },
        { text: textPrompt },
      ],
    });
  }

  const payload = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
  };

  const url = `${API_CONFIGS.gemini.url}?key=${apiKey}`;
  const response = await axios.post(url, payload, {
    timeout: 180000,
  });

  if (!response.data.candidates || response.data.candidates.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.candidates[0].content.parts[0].text;
}
```

### 10.5 跟着敲 - 主分析函数

```typescript
// ===== 继续文件: lib/ai/analyzer.ts =====

// 分析提示词模板
const SINGLE_ANALYSIS_PROMPT = `# 视频镜头提示词反推专家
...`; // 完整模板见源文件

/**
 * 分析图片/帧 - 主函数
 */
export async function analyzeFrames(
  options: AnalyzeOptions
): Promise<AnalyzeResult> {
  const { userId, provider = "zhipu", frames, mode } = options;

  // 获取 API Key (从环境变量或数据库)
  const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`];

  if (!apiKey) {
    return {
      success: false,
      error: `No API key found for ${provider}`,
    };
  }

  // 准备提示词
  const prompt = mode === "batch" ? BATCH_ANALYSIS_PROMPT : SINGLE_ANALYSIS_PROMPT;

  try {
    let result: string;

    if (provider === "zhipu") {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: frame },
            })),
          ],
        },
      ];
      result = await callZhipuApi(apiKey, messages);
    } else if (provider === "gemini") {
      result = await callGeminiApi(apiKey, frames, prompt);
    } else {
      // OpenRouter
      const messages = [...]; // 类似格式
      result = await callOpenRouterApi(apiKey, messages);
    }

    // 提取核心提示词
    const corePrompt = extractCorePrompt(result);

    return {
      success: true,
      prompt: result,
      corePrompt,
    };
  } catch (error: any) {
    console.error("AI Analysis error:", error);
    return {
      success: false,
      error: error.message || "Analysis failed",
    };
  }
}

/**
 * 从结果中提取核心提示词
 */
function extractCorePrompt(result: string): string {
  const match = result.match(/核心提示词[：:]\s*([^\n]+)/);
  if (match) {
    return match[1].trim();
  }
  return result.split("\n")[0]?.trim() || "";
}
```

### 10.6 预期输出

```typescript
// 调用分析
const result = await analyzeFrames({
  userId: "550e8400-...",
  provider: "zhipu",
  frames: [
    "data:image/jpeg;base64,/9j/4AAQ...",
    "data:image/jpeg;base64,/9j/4AAQ...",
  ],
  mode: "single",
});

console.log(result);
/*
{
  success: true,
  prompt: "═══════════════════════════════════════════════════════════════\n【画面深度描述】\n...",
  corePrompt: "A beautiful sunset over the ocean, golden hour lighting..."
}
*/

// 失败情况
/*
{
  success: false,
  error: "No API key found for zhipu"
}
*/
```

---

## 11. 实战：完整分析流程

### 11.1 流程概览

```
用户上传视频 → R2 存储 → FFmpeg 提取帧 → 帧转 Base64 → AI 分析 → 返回结果 → 保存历史
```

### 11.2 跟着敲 - 完整 API

```typescript
// ===== 文件: app/api/analyze/route.ts =====

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, analysisHistory, operationLogs } from "@/lib/db";
import { analyzeFrames, ApiProvider } from "@/lib/ai/analyzer";
import {
  extractFrames,
  frameToBase64,
  cleanupTempFiles,
} from "@/lib/video-processor";
import { getFromR2 } from "@/lib/cloudflare/r2";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    // 1. 认证检查
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. 解析请求体
    const body = await request.json();
    const {
      mediaUrl,          // 视频/图片 URL
      mediaType,        // "video" | "image"
      frameCount = 8,   // 提取帧数
      analyzeMode = "single", // "single" | "batch"
      provider = "zhipu",     // AI 提供商
    } = body;

    // 3. 参数验证
    if (!mediaUrl || !mediaType) {
      return NextResponse.json(
        { error: "Missing mediaUrl or mediaType" },
        { status: 400 }
      );
    }

    // 4. 记录开始日志
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.start",
      resourceType: mediaType,
      metadata: { mediaUrl, frameCount, analyzeMode, provider },
    });

    // 5. 创建临时目录
    tempDir = path.join(process.cwd(), "temp_analysis", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });

    // 6. 处理媒体文件
    let frames: string[] = [];

    if (mediaType === "video") {
      // 6.1 视频处理：下载 → 提取帧 → 转 base64
      const videoPath = path.join(tempDir, "video.mp4");

      // 下载视频
      let videoBuffer: Buffer;
      if (mediaUrl.startsWith("file://")) {
        // 本地文件
        const localPath = mediaUrl.replace("file://", "");
        videoBuffer = await fs.readFile(localPath);
      } else if (mediaUrl.includes(process.env.R2_PUBLIC_URL || "")) {
        // R2 文件
        const key = mediaUrl.replace(`${process.env.R2_PUBLIC_URL}/`, "");
        videoBuffer = await getFromR2(key);
      } else {
        // 远程 URL
        const response = await fetch(mediaUrl);
        videoBuffer = Buffer.from(await response.arrayBuffer());
      }

      await fs.writeFile(videoPath, videoBuffer);

      // 提取帧
      const extractedFrames = await extractFrames(videoPath, frameCount, tempDir);

      // 转 base64
      for (const frame of extractedFrames) {
        const base64 = await frameToBase64(frame.framePath);
        frames.push(base64);
      }
    } else {
      // 6.2 图片处理：下载 → 转 base64
      let imageBuffer: Buffer;

      if (mediaUrl.startsWith("file://")) {
        const localPath = mediaUrl.replace("file://", "");
        imageBuffer = await fs.readFile(localPath);
      } else if (mediaUrl.includes(process.env.R2_PUBLIC_URL || "")) {
        const key = mediaUrl.replace(`${process.env.R2_PUBLIC_URL}/`, "");
        imageBuffer = await getFromR2(key);
      } else {
        const response = await fetch(mediaUrl);
        imageBuffer = Buffer.from(await response.arrayBuffer());
      }

      const base64 = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
      frames.push(base64);
    }

    // 7. 调用 AI 分析
    const result = await analyzeFrames({
      userId: session.user.id,
      provider: provider as ApiProvider,
      frames,
      mode: analyzeMode as "single" | "batch",
    });

    if (!result.success) {
      // 记录错误
      await db.insert(operationLogs).values({
        userId: session.user.id,
        action: "analysis.error",
        resourceType: mediaType,
        metadata: { error: result.error, mediaUrl },
      });

      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // 8. 保存到历史记录
    const historyRecord = await db.insert(analysisHistory).values({
      userId: session.user.id,
      mediaType,
      mediaUrl,
      mediaName: mediaUrl.split("/").pop(),
      frameCount: frames.length,
      analyzeMode,
      prompt: result.prompt!,
      corePrompt: result.corePrompt!,
    }).returning();

    // 9. 记录完成日志
    await db.insert(operationLogs).values({
      userId: session.user.id,
      action: "analysis.complete",
      resourceType: mediaType,
      resourceId: historyRecord[0].id,
      metadata: { mediaUrl, frameCount: frames.length, analyzeMode, provider },
    });

    // 10. 返回结果
    return NextResponse.json({
      success: true,
      prompt: result.prompt,
      corePrompt: result.corePrompt,
      historyId: historyRecord[0].id,
    });

  } catch (error: any) {
    console.error("Analyze error:", error);

    // 错误日志
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user) {
        await db.insert(operationLogs).values({
          userId: session.user.id,
          action: "analysis.error",
          metadata: { error: error.message },
        });
      }
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: error.message || "Analysis failed" },
      { status: 500 }
    );
  } finally {
    // 清理临时文件
    if (tempDir) {
      await cleanupTempFiles(tempDir);
    }
  }
}
```

### 11.3 测试完整流程

```bash
# 使用 curl 测试
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session_token=your-session-token" \
  -d '{
    "mediaUrl": "https://example.com/video.mp4",
    "mediaType": "video",
    "frameCount": 8,
    "analyzeMode": "single",
    "provider": "zhipu"
  }'
```

### 11.4 预期输出

```json
{
  "success": true,
  "prompt": "═══════════════════════════════════════════════════════════════\n【画面深度描述】\n在阳光明媚的海滩上，一位年轻女子...\n\n═══════════════════════════════════════════════════════════════\n【AI视频生成提示词】\n\n📌 核心提示词：\nA beautiful woman walking on the beach at sunset, golden hour lighting...\n\n🎬 主体详细：\n• 人物：年轻女子，长发飘逸\n• 动作：漫步走\n...\n",
  "corePrompt": "A beautiful woman walking on the beach at sunset, golden hour lighting...",
  "historyId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 附录：常用命令

```bash
# 开发
pnpm dev              # 启动开发服务器
pnpm build            # 生产构建
pnpm start            # 运行生产构建

# 代码质量
pnpm lint             # ESLint 检查
pnpm type-check       # TypeScript 类型检查

# 数据库
pnpm db:generate     # 生成迁移文件
pnpm db:migrate       # 执行迁移
pnpm db:push          # 推送 schema (开发用)
pnpm db:studio        # 打开 Drizzle Studio
```

---

## 扩展学习资源

1. **Next.js 15**: https://nextjs.org/docs
2. **Drizzle ORM**: https://orm.drizzle.team
3. **Better-Auth**: https://www.better-auth.com
4. **AWS SDK S3**: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-examples.html
5. **FFmpeg**: https://ffmpeg.org/documentation.html
6. **智谱AI**: https://open.bigmodel.cn/doc

---

happy ending
