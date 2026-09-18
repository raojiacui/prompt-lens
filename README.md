# PromptLens V2

PromptLens V2 是一个 AI 视频创作工作流工具。核心目标不是简单“分析一个视频”，而是把参考视频或图片拆成可编辑、可复刻、可生成的创作蓝图。

用户上传参考素材后，系统会完成上传、拆镜、关键帧提取、音频/字幕上下文整理、AI 分析、提示词生成和二次改写，最终帮助用户快速做同款、改同款、生成新视频。

## 当前产品形态

PromptLens V2 支持上传本地素材，也支持粘贴公开视频链接作为分析来源。

- 上传视频或图片进行分析
- 粘贴 YouTube、TikTok、X、抖音或 Bilibili 公热视频链接进行分析
- 10 秒以内视频按单镜头分析
- 已解锁长视频权限的账号可上传长视频自动拆镜
- 本地 FFmpeg worker 负责长视频切镜、切 clip、抽关键帧、抽音频
- AI 分析每个镜头的画面、角色、动作、镜头语言、光线、色彩、风格、剧情作用和复刻提示词
- 支持对单个镜头提示词进行 AI 改写和重试分析
- 支持把镜头提示词发送到视频生成流程做同款
- 支持图片作为单场景参考图进行分析
- 支持管理员、平台积分、免费体验和 BYOK 等不同权限模式

## 创作闭环

```text
上传参考视频/图片
        ↓
创建项目并上传到 R2
        ↓
短视频：单镜头分析
长视频：本地 FFmpeg worker 自动拆镜
        ↓
抽取 clip / keyframe / audio
        ↓
AI 分析每个镜头，生成结构化蓝图和复刻 Prompt
        ↓
用户复制、改写、重试或发送到视频生成
        ↓
生成自己的视频版本
```

## 长视频切镜说明

长视频切镜依赖本地 FFmpeg worker。Vercel Serverless 不适合直接跑 FFmpeg，所以本地开发或自托管部署时需要单独启动 worker。

worker 当前接口：

```http
GET /healthz
POST /breakdown
```

`/breakdown` 输入：

```json
{
  "videoUrl": "https://your-r2-public-url/video.mp4"
}
```

`/breakdown` 会执行：

- 下载上传后的视频文件
- 用 `ffprobe` 读取时长、分辨率、fps、音轨信息
- 用 `ffmpeg` scene detection 检测画面切点
- 对过长连续片段按 `MAX_SCENE_SECONDS` 继续分段，默认 8 秒
- 为每个片段生成 clip、关键帧和音频
- 上传生成资源到 Cloudflare R2
- 返回 scenes 列表给 Next.js 后端继续做 AI 分析

如果视频画面变化明显，会更接近真实镜头切分。如果视频几乎没有转场或视觉变化，系统会更像按长片段分段。

## 权限和计费逻辑

前端和 API 会区分短视频与长视频：

- 免费体验/未付费账号：默认只支持 10 秒以内完整镜头片段
- 管理员账号：不受时长和积分限制
- 已购买/解锁长视频分析能力的账号：可上传长视频自动拆镜
- 长视频分析会按基础消耗加镜头数消耗积分

实际限制以 `lib/billing/video-analysis.ts` 和 `/api/credits/me` 返回能力为准。

## 技术栈

- 前端：Next.js 15, React 19, TypeScript
- UI：Tailwind CSS, shadcn/ui, lucide-react
- 后端：Next.js API Routes
- 数据库：PostgreSQL + Drizzle ORM
- 认证：better-auth
- 存储：Cloudflare R2
- 视频处理：本地/self-hosted FFmpeg worker
- AI 分析：Kie.ai / OpenRouter / 其他模型路由
- 视频生成：Kie.ai 系列接口
- 支付：Creem、XunhuPay / 虎皮椒
- 测试：Vitest, Playwright

## 本地启动

### 1. 安装依赖

```powershell
cd C:\Users\雨下雨停\prompt-lens-tmp
pnpm install
```

### 2. 配置环境变量

复制环境变量模板：

```powershell
Copy-Item .env.example .env.local
```

至少需要配置：

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/prompt_analyzer
BETTER_AUTH_SECRET=your-secret
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
TRUSTED_ORIGINS=http://localhost:3000

R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_PUBLIC_URL=https://your-r2-public-domain

FFMPEG_WORKER_URL=http://localhost:8080
FFMPEG_WORKER_SECRET=your-worker-secret
BYOK_ENCRYPTION_KEY=your-32-byte-compatible-secret

KIE_API_KEY=your-kie-api-key
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_ANALYSIS_MODEL=google/gemini-2.5-flash
```

本地 worker 脚本会自动把 `FFMPEG_WORKER_SECRET` 映射成 worker 内部使用的 `WORKER_SECRET`。

### 3. 初始化数据库

```powershell
pnpm db:push
```

### 4. 启动 Next.js

```powershell
pnpm dev
```

访问：

```text
http://localhost:3000
```

### 5. 启动本地 FFmpeg worker

另开一个 PowerShell：

```powershell
cd C:\Users\雨下雨停\prompt-lens-tmp
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-ffmpeg-worker.ps1
```

成功输出：

```text
Starting Prompt Lens FFmpeg worker on port 8080
Prompt Lens FFmpeg worker listening on 8080
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8080/healthz
```

期望返回：

```json
{"ok":true}
```

## FFmpeg 要求

长视频拆镜需要本机可执行：

```powershell
ffmpeg -version
ffprobe -version
```

如果命令不可用，请安装 FFmpeg，并确认 `ffmpeg.exe` 和 `ffprobe.exe` 在 PATH 中。Windows 推荐使用 winget 安装的 Gyan FFmpeg full build。

当前启动脚本会检查：

- Node.js 是否存在且版本为 20+
- `node_modules` 是否存在
- `.env.local` 是否存在
- `FFMPEG_WORKER_SECRET` / `WORKER_SECRET` 映射
- R2 endpoint 自动补齐
- 8080 端口是否被占用
- `ffmpeg` / `ffprobe` 是否可执行

## 使用说明

### 视频/图片分析

1. 登录账号
2. 进入视频分析页
3. 上传视频或图片
4. 选择分析模型，默认 Auto Balanced
5. 点击 Analyze Video / Analyze Image
6. 等待上传、拆镜和 AI 分析完成
7. 查看每个镜头的复刻 Prompt、画面拆解、镜头语言和音频上下文
8. 可复制 Prompt、AI 改写、Retry，或点击“做同款”进入视频生成

### 长视频分析

长视频需要同时满足：

- 本地 FFmpeg worker 正在运行
- `.env.local` 中 `FFMPEG_WORKER_URL=http://localhost:8080`
- R2 配置可上传和公开访问资源
- 当前账号具备长视频分析权限或管理员权限
- 积分余额足够覆盖基础消耗和镜头数消耗

### 图片分析

图片不会走 FFmpeg worker，会作为单场景参考素材直接进入 AI 分析流程。

### 视频平台链接

平台链接解析后端使用 LEAPERone，支持 YouTube、TikTok、X、抖音和 Bilibili 的公开视频。用户可在视频分析页切换到“粘贴链接”；应用取得临时媒体流后会立即交给媒体 worker 下载并保存到 R2，再沿用现有的分析报价、自动拆镜和积分结算流程。链接解析接口要求登录、同源请求，并按用户限流；拆镜流程不长期依赖第三方临时直链，也不使用 `yt-dlp` 或共享登录 Cookie。

## 项目结构

```text
prompt-lens/
├── app/                         # Next.js App Router 和 API Routes
│   ├── api/                     # 后端接口
│   ├── dashboard/               # 主功能页面
│   └── login/                   # 登录页面
├── components/                  # React 组件
│   └── workflow/                # V2 视频工作流 UI
├── lib/                         # 核心业务逻辑
│   ├── ai/                      # 模型路由和 AI 分析
│   ├── auth/                    # better-auth 配置
│   ├── billing/                 # 积分、套餐、权限
│   ├── db/                      # Drizzle 数据库
│   ├── ffmpeg-worker/           # Next.js 调用 worker 的客户端
│   └── workflow/                # 项目、拆镜、分析、改写服务
├── workers/
│   └── ffmpeg-worker/           # 本地 FFmpeg HTTP worker
├── scripts/
│   └── start-local-ffmpeg-worker.ps1
└── tests/                       # Vitest / Playwright 测试
```

## 关键 API

### Workflow

- `POST /api/workflow/projects`：创建项目
- `GET /api/workflow/projects`：项目列表
- `GET /api/workflow/projects/:id`：项目详情
- `DELETE /api/workflow/projects/:id`：删除项目
- `POST /api/workflow/projects/:id/breakdown`：上传素材后的拆解和 AI 分析
- `POST /api/workflow/projects/:id/scenes/:sceneVersionId/rewrite`：按用户指令改写镜头
- `POST /api/workflow/projects/:id/scenes/:sceneVersionId/retry`：重试镜头分析

### Worker

- `GET /healthz`：worker 健康检查
- `POST /breakdown`：长视频拆镜和资源提取

## 常见问题

### worker 能启动，但长视频分析失败

优先检查：

```powershell
ffmpeg -version
ffprobe -version
Invoke-WebRequest -UseBasicParsing http://localhost:8080/healthz
```

还要确认 R2 的 `R2_PUBLIC_URL` 可以被 worker 下载和后端/AI 服务访问。

### 上传 2 分钟视频可以吗

技术上可以。只要账号具备长视频权限、worker 正常运行、R2 配置正确，系统会自动拆镜并逐镜头分析。但 2 分钟视频会产生更多 clips/keyframes/audio，也会消耗更多分析时间和积分。

### 为什么 10 秒以内视频不切镜

10 秒以内默认视为一个完整镜头片段，会走 single-shot 分析，避免不必要的 FFmpeg 拆分和积分浪费。

### 视频链接为什么要先入库

LEAPERone 返回的媒体地址有时效性。PromptLens 会在解析成功后立即把视频保存到自己的 R2，再进行读取时长、报价、拆镜和分析，避免长任务执行期间第三方地址过期。

## 部署说明

Next.js 主站可以部署到 Vercel，但长视频拆镜 worker 不建议部署到 Vercel Serverless。生产环境需要把 `workers/ffmpeg-worker/server.mjs` 部署到支持长时间运行和 FFmpeg 的服务器，并设置：

```env
FFMPEG_WORKER_URL=https://your-worker-domain
FFMPEG_WORKER_SECRET=your-worker-secret
```

worker 服务器需要配置同一组 R2 环境变量，并安装 `ffmpeg` / `ffprobe`。

## License

MIT
