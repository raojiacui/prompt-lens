# PromptLens V2

PromptLens V2 是一个 AI 视频创作工作流工具，把参考视频或图片拆成可编辑、可复刻、可生成的创作蓝图。

用户上传参考素材后，系统会完成上传、拆镜、关键帧提取、AI 分析、提示词生成和二次改写，并按所用流程整理可用的音频/字幕上下文，帮助用户做同款、改同款、生成新视频。

## V2 操作演示

以公开样例「动物城邦」为素材：约 27 秒、11 个镜头。下方 GIF 录制于 2026-10-11，来自实际页面操作画面，保留关键步骤并缩短等待时间；生成操作录到当时的费用确认页，未提交新的视频生成任务。分析结果来自已有历史项目。

当前生成页已移除费用确认弹窗：选择「平台积分 / 自带 Key」，查看按钮上的报价后，点击生成直接提交。下方动图中的确认弹窗属于旧版界面。

![视频分析与三条视频生成链路的动态矢量概览](docs/demos/workflow.svg)

### 视频分析：上传或粘贴链接 → 拆镜 → 选择镜头 → 提示词

展示本地上传和链接输入入口、11 镜头预览、按需勾选与费用确认，再切换到已有完整分析结果，查看镜头画面和复刻提示词。

![动物城邦的上传、拆镜、镜头选择和完整提示词](docs/demos/01-video-analysis.gif)

### AI 改写与做同款

输入修改要求，查看改写版本、滚动阅读并回看原版；点击「做同款」将当前提示词带入生成页。AI 改写按钮会直接提交改写请求，使用前请确认费用来源与额度。

![AI 改写、提示词版本切换与做同款](docs/demos/02-rewrite-remake.gif)

### 文生视频

填写提示词，选择模型、画幅、分辨率、时长和数量，然后获取报价。

![文生视频参数设置与费用确认](docs/demos/03-text-to-video.gif)

### 图生视频

上传动物城邦的关键帧，页面自动切换为图生视频；结合提示词获取报价。

![参考图上传、图生视频模式与费用确认](docs/demos/04-image-to-video.gif)

### 参考视频生成与视频编辑

上传拆出的猫咪镜头，参考其动作、节奏和运镜；选择 **Wan 2.7 Video Edit** 时，上传片段会成为被编辑素材。服务端检测视频时长后给出报价。

![参考视频上传、视频编辑要求与真实报价](docs/demos/05-reference-video.gif)

<details>
<summary>查看已有生成历史</summary>

历史记录与本次动物城邦演示分别展示。录制时核对的文生、图生历史成片链接已返回 404，因此这里展示已有记录、提示词和查看入口。生成后请及时下载，视频链接有效期以服务商为准。

![已有生成历史与结果入口](docs/demos/06-generation-history.gif)

</details>

录制日期：2026-10-11。画面中的报价仅代表当时的模型、参数与素材组合，实际费用以页面报价为准。[演示素材说明](docs/demos/README.md)

## 当前产品形态

PromptLens V2 支持上传本地素材，也支持粘贴公开视频链接作为分析来源。

- 上传视频或图片进行分析
- 粘贴 TikTok、抖音或 Bilibili 公热视频链接进行分析
- 支持整段分析或自动拆镜；免费体验推荐上传 10 秒以内的完整单镜头片段
- 自动拆镜需具备相应权限，非管理员需购买平台积分；自带 Key 可用于镜头分析
- 独立部署的 FFmpeg worker 负责切镜、切 clip、抽关键帧、抽音频和视频时长检测
- AI 分析每个镜头的画面、角色、动作、镜头语言、光线、色彩、风格、剧情作用和复刻提示词
- 支持对单个镜头提示词进行 AI 改写和重试分析
- 支持把镜头提示词发送到视频生成流程做同款
- 支持图片作为单场景参考图进行分析
- 支持管理员、平台积分、免费体验和 BYOK 等不同权限模式
- 商业视频分析默认使用持久化单镜头任务，每条视频最多并行分析两个镜头
- 模型答案先保存检查点，再写入正式结果；失败镜头可单独重试，已成功镜头保留
- 视频生成支持文生、图生、参考视频和视频编辑，报价随模型、素材与参数更新

## 创作闭环

```text
上传参考视频/图片
        ↓
创建项目并上传到 R2
        ↓
整段分析：作为一个镜头
自动拆镜：FFmpeg worker 创建镜头列表
        ↓
抽取 clip / keyframe / audio
        ↓
商业分析：镜头任务入库 → 每视频最多 2 个并行分析
        ↓
模型答案检查点 → 保存结构化蓝图和复刻 Prompt
        ↓
用户复制、改写、重试或发送到视频生成
        ↓
生成自己的视频版本
```

### 商业分析的执行与恢复

商业视频分析和失败镜头重试已全面使用独立镜头队列，无需实验开关或账号白名单。免费试用和图片分析仍使用各自的执行与计费流程。

| 环节 | 当前行为 |
| --- | --- |
| 镜头执行 | 每个镜头有独立数据库任务；单视频最多两个任务同时推理，结果可按完成先后返回，页面按镜头编号展示 |
| KIE 调用限制 | PostgreSQL 按 Key 指纹跨进程协调；同一 Key 最多四个有效占位，十秒内最多启动十五次 |
| 连接失败 | 明确未建立连接的错误内部重试一次；524、响应丢失或结果未知的请求保留保护，避免自动重复调用 |
| 结果保存 | 先持久化模型答案，再写正式结果；短暂数据库错误会重试保存，后台可恢复已有答案，无需再次调用模型 |
| 镜头重试与结算 | 只重试选中的失败镜头，复用素材并更新原镜头结果；结算扣除此前已收费部分，已成功镜头和已交付拆镜不重复收费 |
| 后台调度 | 本地开发启动账号范围内的自动扫描；生产由鉴权 Cron 派发和对账，关闭浏览器后仍需调度器推进 |
| 历史任务 | 未完成的旧任务在执行锁下转入新队列；保留已完成镜头、答案检查点和计费记录，旧串行商业推理路径已移除 |

并发与限流计数覆盖独立商业分析请求，免费试用和视频生成按各自调用路径处理。实际耗时仍取决于素材处理、数据库连接和模型响应。实现与回退要求见[独立镜头分析说明](docs/independent-scene-analysis.md)，保存阶段诊断见[排查记录](docs/scene-save-investigation.md)。

### 公开分析样例

样例页包含原视频、镜头素材、完整分析和提示词。以下为本地测试地址，部署后使用相同的 `/samples` 路径。

| 样例 | 镜头数 | 页面 |
| --- | --- | --- |
| 山海经 | 14 | [查看分析](http://localhost:3001/samples/1a54fb8d-254a-4867-910f-b7d4c6ae8ac0) |
| 赛博神祇 | 5 | [查看分析](http://localhost:3001/samples/61998c4e-4df0-405e-8200-d99a1d0d734d) |
| 风在耳边呼啸，山在脚下臣服 | 7 | [查看分析](http://localhost:3001/samples/52457e72-44d6-41e1-ae89-8233ef50082c) |

样例分析数据由仓库中的公开快照提供，媒体文件来自 R2；查看样例不会创建新的模型任务。

## 长视频切镜说明

自动拆镜依赖独立的 FFmpeg worker。Vercel Serverless 不适合直接跑 FFmpeg，本地开发单独启动 worker，生产部署到支持长任务和 FFmpeg 的服务器。

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

前端和 API 会根据账号权限、费用来源及是否自动拆镜选择流程：

- 免费体验/未付费账号：推荐 10 秒以内完整镜头片段，无法直接使用付费自动拆镜能力
- 管理员账号：可使用额外模型与拆镜权限，商业分析仍以服务端报价和钱包结算为准
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
- AI 分析：Kie.ai（免费试用锁定 Gemini 3.8 Flash）
- 视频生成：Kie.ai 系列接口
- 支付：支付宝开放平台网页支付、Creem
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

已有 `.env.local` 时保留现有文件，按模板补齐缺少的变量。

本地测试使用 3001 端口，至少需要配置：

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/prompt_analyzer
DATABASE_MAX_CONNECTIONS=5
BETTER_AUTH_SECRET=your-secret
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3001
TRUSTED_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
LOCAL_ANALYSIS_BASE_URL=http://127.0.0.1:3001
LOCAL_ANALYSIS_USER_IDS=your-local-test-account-uuid
CRON_SECRET=your-random-server-only-secret
# 本地验证商业流程时启用；先应用所需迁移并配置测试账号钱包。
COMMERCIAL_CONSUMPTION_ENABLED=true

R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_PUBLIC_URL=https://your-r2-public-domain

FFMPEG_WORKER_URL=http://localhost:8080
FFMPEG_WORKER_SECRET=your-worker-secret
BYOK_ENCRYPTION_KEY=your-32-byte-compatible-secret

KIE_API_KEY=your-kie-api-key
```

本地 worker 脚本会自动把 `FFMPEG_WORKER_SECRET` 映射成 worker 内部使用的 `WORKER_SECRET`。

`LOCAL_ANALYSIS_USER_IDS` 填写测试账号的用户 UUID，多个账号用逗号分隔。它只限制本地后台扫描的范围，适用于本地与线上共用数据库的情况，所有账号的商业分析均使用新队列。开发调度器要求显式的 HTTP 回环地址、账号列表及 `CRON_SECRET`，每轮结束后间隔 15 秒再扫描。

远程数据库使用服务商提供的连接地址，并按要求启用 TLS。例如：

```env
DATABASE_URL=postgres://user:password@your-database-host:6543/postgres?sslmode=require
```

已有查询参数时使用 `&sslmode=require`。本机 PostgreSQL 是否启用 TLS 以本机配置为准；不要通过关闭证书校验排查连接问题。`CONNECT_TIMEOUT` 需要分别检查 DNS、端口、线路和数据库服务状态，页面能打开不代表数据库连接稳定。

### 3. 应用数据库迁移

```powershell
node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate
```

新库按迁移历史依次创建结构；已有数据库先核对已应用迁移，再补齐缺失项。独立镜头队列必须包含 `0023_analysis_scene_jobs.sql` 和 `0024_analysis_provider_slots.sql`，分别创建镜头任务和跨实例 KIE 占位表。共享或生产数据库应使用迁移记录管理变更。

`pnpm db:check-v2` 当前只检查到 `0019` 的基础结构，不能证明 `0023`、`0024` 已应用。部署前还应核对这两张新表及迁移记录。

### 4. 启动 Next.js

```powershell
pnpm dev --port 3001
```

访问：

```text
http://localhost:3001/dashboard?tab=analyze
```

视频生成：`http://localhost:3001/dashboard?tab=video-gen`；公开样例：`http://localhost:3001/samples`。直接运行 `pnpm dev` 默认使用 3000 端口，认证地址、站点地址和 `LOCAL_ANALYSIS_BASE_URL` 也需同步调整。

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
4. 选择整段分析或自动拆镜、可用模型及费用来源
5. 提交素材；付费拆镜后可选择镜头并查看分析报价
6. 确认分析后等待结果，已完成镜头会陆续显示
7. 查看每个镜头的复刻 Prompt、画面拆解、镜头语言和音频上下文
8. 可复制 Prompt、AI 改写、Retry，或点击“做同款”进入视频生成

### 长视频分析

长视频需要同时满足：

- 独立 FFmpeg worker 正在运行
- `FFMPEG_WORKER_URL` 指向可访问的 worker；本地启动时通常为 `http://localhost:8080`
- R2 配置可上传和公开访问资源
- 当前账号具备长视频分析权限或管理员权限
- 积分余额足够覆盖基础消耗和镜头数消耗

### 图片分析

图片不会走 FFmpeg worker，会作为单场景参考素材直接进入 AI 分析流程。

### 视频生成

1. 填写提示词，按需上传参考图片或视频
2. 选择模型、画幅、分辨率、时长和数量
3. 在按钮旁选择「平台积分 / 自带 Key」，查看生成按钮的报价
4. 点击生成直接提交；服务端继续校验参数、余额、Key 和最终报价
5. 在页面查看进度、错误和生成历史，完成后及时下载视频

生成页不再弹出费用确认窗口，报价展示也不依赖余额查询成功。需要检测参考视频时长的模型，会在素材信息就绪后提供对应报价。

### 视频平台链接

平台链接解析统一使用 EasyDown，目标平台为 TikTok、抖音和 Bilibili 的公开视频。用户可在视频分析页切换到“粘贴链接”；应用取得临时媒体流后会立即交给媒体 worker 下载并保存到 R2，再沿用现有的分析报价、自动拆镜和积分结算流程。链接解析接口要求登录、同源请求，并按用户限流；拆镜流程不长期依赖第三方临时直链，也不使用 `yt-dlp` 或共享登录 Cookie。EasyDown 需设置服务端环境变量 `EASYDOWN_API_KEY`；未配置时明确报错，不回退到其他解析服务。上线前需逐个平台测试解析与媒体下载。

调用收费解析接口前，会通过空的 `/ingest-media` 请求检查 worker 鉴权与存储配置，不下载或上传素材。同一用户、同一链接的成功解析结果在单个服务进程内复用十分钟，避免下载失败后的短期重试重复调用服务商；并发请求复用同一个解析调用。缓存最多保留 128 项，不跨实例共享，进程重启或缓存到期后会重新解析。平台积分与套餐导入次数仅在入库成功后结算，但服务商可能在解析成功时已收费，二者不可混为一谈。

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
│   └── ffmpeg-worker/           # 独立部署的 FFmpeg HTTP worker
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
- `POST /api/commercial/analysis`：准备素材、获取分析报价，或通过 `action=retry` 报价失败镜头重试
- `POST /api/commercial/confirm`：幂等确认商业报价并创建后台任务
- `GET /api/commercial/tasks/:id`：读取任务进度和部分结果
- `POST /api/internal/analysis-run`：鉴权后的后台任务执行入口
- `GET /api/cron/analysis-dispatch`：派发任务、恢复镜头检查点并补位

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

### 整段分析和自动拆镜如何选择

整段分析把视频作为一个场景，适合完整单镜头片段；自动拆镜适合多镜头视频，需具备相应权限。按实际素材选择，避免对一个连续镜头做不必要的拆分，也避免将多镜头长视频整段分析造成信息遗漏。

### 视频链接为什么要先入库

解析服务返回的媒体地址有时效性。PromptLens 会在解析成功后立即把视频保存到自己的 R2，再进行读取时长、报价、拆镜和分析，避免长任务执行期间第三方地址过期。

## 部署说明

Next.js 主站可以部署到 Vercel，但长视频拆镜 worker 不建议部署到 Vercel Serverless。生产环境需要把 `workers/ffmpeg-worker/server.mjs` 部署到支持长时间运行和 FFmpeg 的服务器，并设置：

```env
FFMPEG_WORKER_URL=https://your-worker-domain
FFMPEG_WORKER_SECRET=your-worker-secret
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_BETTER_AUTH_URL=https://your-domain.com
TRUSTED_ORIGINS=https://your-domain.com
COMMERCIAL_RECONCILIATION_BASE_URL=https://your-domain.com
CRON_SECRET=your-random-server-only-secret
```

worker 服务器需要配置同一组 R2 环境变量，并安装 `ffmpeg` / `ffprobe`。

### 上线前核对

- 应用所需迁移，包括 `0023` 和 `0024`；生产环境的 `DATABASE_URL` 按服务商要求启用 TLS。
- Web 与 worker 使用相同的 `CRON_SECRET`；worker 的 `COMMERCIAL_RECONCILIATION_BASE_URL` 指向正式 Web HTTPS 根地址。
- `vercel.json` 已配置 `/api/cron/analysis-dispatch` 每分钟执行，素材清理和商业对账每天执行。部署套餐需支持对应频率；自托管需要外部调度器按相同路由、Bearer 鉴权调用。
- 生产不运行开发环境的 15 秒扫描器。确认派发与对账实际执行，并验证关闭浏览器后任务能够继续完成；避免为同一个职责重复部署调度器。
- 按[商业环境模板](docs/commercial-env.example)核对计费开关与验收项。当前代码的 `COMMERCIAL_MIGRATION_ACCEPTED` 验收标记仍为 `0019`，它与独立队列需要的 `0023/0024` 结构检查分别核对。
- 实测免费体验、平台积分、BYOK、单镜头重试、未知模型结果及数据库短暂失败；核对恢复后的镜头数和结算，避免重复收费。
- 检查公开样例的原视频、镜头片段和关键帧可访问；现有样例快照会随代码部署公开。

本地成功记录和自动测试用于验证已覆盖场景，生产调度、真实服务连接和计费仍需在目标环境完成验收。发布操作由维护者单独执行。

### 常用验证命令

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run tests/analysis-dispatch.test.ts tests/scene-job-dispatch.test.ts tests/commercial-wallet.test.ts tests/kie-client.test.ts tests/local-analysis-scheduler.test.ts
```

这些测试使用隔离数据库和模拟模型响应，不会验证线上 Key 或服务可用性。真实 PostgreSQL 的保存与锁等待诊断需要专用临时库，操作说明见[排查记录](docs/scene-save-investigation.md)。

## License

MIT

## Star 趋势

[![Star History](https://api.star-history.com/svg?repos=raojiacui/prompt-lens&type=Date&legend=top-left)](https://www.star-history.com/?repos=raojiacui%2Fprompt-lens&type=date&legend=top-left)

## 请勿刷 Star 或 Fork

请不要使用机器人、脚本、批量账号或刷星服务给本仓库添加 Star 或 Fork。

欢迎真实用户因兴趣或使用需要自愿 Star、Fork，也欢迎反馈问题、分享使用体验和贡献代码。感谢每一份真实的支持。

Please do not use bots, scripts, bulk accounts, or paid services to inflate this repository's stars or forks, including unsolicited promotion. Genuine interest, feedback, and contributions are welcome.
