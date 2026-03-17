# Prompt Analyzer - AI 协作指南

> 本文件是 AI 开发的核心文档，包含项目关键信息和开发规范。

---

## 项目概览

- **项目名称**: Prompt Analyzer (视频提示词分析工具)
- **域名**: prompt-analyzer.com (待部署)
- **技术栈**: Next.js 15 + React 19 + TypeScript
- **包管理器**: pnpm
- **数据库**: Supabase PostgreSQL + Drizzle ORM
- **认证**: better-auth (Google 登录)
- **存储**: Cloudflare R2
- **部署**: Vercel

---

## 功能范围

| 功能 | 状态 | 说明 |
|------|------|------|
| 视频/图片上传 | ✅ | 上传到 R2 存储 |
| 帧提取 | ✅ | 使用 FFmpeg 服务端提取 |
| AI 分析 | ✅ | 支持智谱AI/Gemini/OpenRouter |
| 历史记录 | ⏳ | 开发中 |
| 用户设置 | ⏳ | 开发中 |
| 管理员后台 | ⏳ | 开发中 |
| 操作日志 | ✅ | 已实现 |

---

## 开发环境

### 运行命令

```bash
# 安装依赖
pnpm install

# 开发服务器
pnpm dev

# 构建
pnpm build

# 代码检查
pnpm lint

# 测试
pnpm test

# 数据库
pnpm db:generate  # 生成迁移
pnpm db:migrate   # 执行迁移
pnpm db:push      # 推送 schema
```

### 环境变量

```bash
# Database
DATABASE_URL=postgres://...

# Auth
BETTER_AUTH_SECRET=
NEXT_PUBLIC_BETTER_AUTH_URL=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Site
NEXT_PUBLIC_SITE_URL=

# Admin
ADMIN_EMAILS=admin@example.com
```

---

## 目录结构

```
prompt-analyzer/
├── app/
│   ├── api/
│   │   ├── auth/           # 认证 API
│   │   ├── analyze/        # 分析 API
│   │   └── upload/         # 上传 API
│   ├── login/              # 登录页
│   ├── dashboard/          # 主功能页
│   └── page.tsx            # 首页
├── components/             # React 组件
│   └── ui/                 # 基础 UI 组件
├── lib/
│   ├── ai/                 # AI 分析器
│   ├── auth/               # 认证配置
│   ├── cloudflare/         # R2 存储
│   ├── db/                 # 数据库
│   ├── middleware/         # 中间件
│   ├── utils/              # 工具函数
│   └── video-processor/    # 视频处理
├── tests/                  # 测试文件
└── i18n/                   # 国际化
```

---

## 开发规范

### TypeScript

```typescript
// ✅ 正确：明确类型定义
interface ButtonProps {
  variant: 'primary' | 'secondary';
  onClick: () => void;
  children: React.ReactNode;
}

// ❌ 错误：使用 any
function processData(data: any) { ... }
```

### API 设计

```typescript
// API 路由应返回统一的响应格式
export async function POST(request: NextRequest) {
  try {
    // 处理逻辑
    return NextResponse.json({ success: true, data: ... });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### 数据库操作

```typescript
// 使用 Drizzle ORM
import { db } from '@/lib/db';
import { analysisHistory } from '@/lib/db/schema';

// 查询
const results = await db.query.analysisHistory.findMany({
  where: eq(analysisHistory.userId, userId),
});

// 插入
await db.insert(analysisHistory).values({...});
```

---

## 常见问题

### Vercel 上无法使用 FFmpeg

- Vercel Serverless Functions 有 10MB 内存限制
- 解决方案：使用专门的视频处理服务（如 Mux）或部署独立处理服务

### API Key 安全

- 用户 API Key 存储在数据库中
- 生产环境应加密存储
- 当前实现为明文存储，仅供演示

---

## 后续计划

1. 完善历史记录功能
2. 实现用户 API Key 管理界面
3. 添加管理员后台
4. 实现操作日志查看
5. 添加速率限制
6. 编写 E2E 测试
