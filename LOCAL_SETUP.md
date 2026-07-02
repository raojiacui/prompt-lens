# 本地部署详细教程

> 本教程面向零基础小白，按顺序操作即可在本地跑起 PromptLens。
>
> 全程免费，不需要付费任何服务。

---

## 目录

- [一、准备工作：安装必要软件](#一准备工作安装必要软件)
- [二、拉取项目代码](#二拉取项目代码)
- [三、配置数据库（二选一）](#三配置数据库二选一)
  - [方案 A：Docker 本地 PostgreSQL（推荐，最快）](#方案-adocker-本地-postgresql推荐最快)
  - [方案 B：Supabase 云数据库（免装 Docker）](#方案-bsupabase-云数据库免装-docker)
- [四、配置 Backblaze B2 存储（免费 10GB）](#四配置-backblaze-b2-存储免费-10gb)
- [五、配置 Google 登录（可跳过）](#五配置-google-登录可跳过)
- [六、配置 AI API Key（至少选一个）](#六配置-ai-api-key至少选一个)
- [七、填写环境变量](#七填写环境变量)
- [八、初始化数据库 & 启动](#八初始化数据库--启动)
- [九、常见问题](#九常见问题)

---

## 一、准备工作：安装必要软件

在开始之前，你的电脑需要装好下面三个软件。

### 1. Node.js（运行时）

- 下载地址：https://nodejs.org/
- 选 **LTS 版本**（左边的按钮）
- 安装时一路 Next 即可，Windows 用户注意勾选"Add to PATH"
- 验证：打开终端输入 `node -v`，应输出 `v20.x` 或更高

### 2. pnpm（包管理器）

Node.js 装好后，打开终端执行：

```bash
npm install -g pnpm
```

验证：`pnpm -v`，应输出版本号。

### 3. Git（版本管理工具）

- 下载地址：https://git-scm.com/
- Windows 用户下载后一路 Next 安装
- 验证：`git -v`

> **Windows 用户建议**：用 **Git Bash**（装完 Git 后开始菜单里有）或 **WSL** 运行命令，比 PowerShell 兼容性好。

---

## 二、拉取项目代码

打开终端，进入你想存放项目的目录（比如 `D:\projects`），执行：

```bash
git clone https://github.com/raojiacui/prompt-lens.git
cd prompt-lens
```

然后安装依赖：

```bash
pnpm install
```

> 第一次安装会下载几百 MB 的依赖，耐心等 2-5 分钟。

---

## 三、配置数据库（二选一）

本项目用 PostgreSQL 数据库存数据。你有两个选择，**任选其一**即可。

### 方案 A：Docker 本地 PostgreSQL（推荐，最快）

如果你电脑上有 Docker，这是最快的方式——数据完全存在本地，不用注册任何云服务。

#### 步骤 1：安装 Docker（如果还没装）

- **Windows/Mac**：下载 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 安装
- **Mac 用户也可以用** [OrbStack](https://orbstack.dev/)（更轻量、更快，免费）
- **Linux**：用系统包管理器装，例如 `sudo apt install docker.io`

装好后验证：

```bash
docker -v
```

#### 步骤 2：启动一个本地 PostgreSQL

在项目根目录执行：

```bash
docker run -d \
  --name prompt-lens-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=prompt_analyzer \
  -p 5432:5432 \
  -v prompt-lens-pgdata:/var/lib/postgresql/data \
  postgres:16
```

解释：
- `-d` 后台运行
- `--name` 容器名叫 `prompt-lens-db`
- `-p 5432:5432` 把容器的 5432 端口映射到本机
- `-v` 把数据存在名为 `prompt-lens-pgdata` 的 volume 里（容器删了数据还在）

#### 步骤 3：记下数据库连接串

你的 `DATABASE_URL` 是：

```
postgresql://postgres:postgres@localhost:5432/prompt_analyzer
```

#### 常用命令

```bash
# 停止数据库
docker stop prompt-lens-db

# 启动（已经创建过）
docker start prompt-lens-db

# 删除数据库（数据保留在 volume 里）
docker rm -f prompt-lens-db

# 彻底删除数据（小心！）
docker volume rm prompt-lens-pgdata
```

---

### 方案 B：Supabase 云数据库（免装 Docker）

如果你不想装 Docker，可以用 Supabase 的免费云数据库（500MB 免费，足够个人使用）。

#### 步骤 1：注册 Supabase

1. 打开 https://supabase.com
2. 点 **Start your project** → 用 GitHub 账号登录（没有就注册一个 GitHub）
3. 登录后点 **New project**

#### 步骤 2：创建项目

- **Name**：随便填，如 `prompt-lens`
- **Database Password**：自动生成一个强密码，**复制保存好**（只显示一次）
- **Region**：选离你最近的（中国用户选 Singapore / Tokyo）
- **Pricing Plan**：Free
- 点 **Create new project**，等 1-2 分钟

#### 步骤 3：获取连接串

1. 项目创建好后，左侧菜单点 **Project Settings**（左下角齿轮图标）
2. 点 **Database**
3. 找到 **Connection string** 区域，选 **URI** 格式
4. 复制这段连接串，形如：
   ```
   postgresql://postgres.xxxxxxxx:你的密码@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```

> **小提示**：如果它给你的是 `postgresql://postgres:password@...`（不带 `.xxxx`），用那个也行。

把这个连接串记下来，下一步要用。

---

## 四、配置 Backblaze B2 存储（免费 10GB）

B2 用来存用户上传的视频和图片，免费 10GB 够个人用很久。

### 1. 注册 Backblaze

打开 https://www.backblaze.com/b2/cloud-storage.html 注册账号（邮箱注册即可）。

### 2. 创建 Bucket

1. 登录后进入 **B2 Cloud Storage** → **Buckets**
2. 点 **Create a Bucket**
   - **Bucket Unique Name**：自己起个名，如 `prompt-analyzer-你的名字`
   - **Files in Bucket are**: ⚠️ **一定要选 Private**（不要选 Public）
   - 其他默认，点 **Create a Bucket**

3. 记下两个信息：
   - **Bucket name**
   - **Endpoint**：形如 `s3.us-west-000.backblazeb2.com`（其中 `us-west-000` 就是区域）

### 3. 创建 Application Key

1. 左侧菜单点 **App Keys** → **Add a New Application Key**
2. 填写：
   - **Name**：随便，如 `prompt-lens`
   - **Allow access to Bucket(s)**：选你刚才创建的 bucket
   - 其他默认
3. 点 **Create New Key**
4. ⚠️ **立即复制保存**：
   - **keyID**
   - **applicationKey**（只显示这一次！如果丢了就再创建一个新的）

### 4. 拼接 B2_PUBLIC_URL

格式是：
```
https://f{数字}.backblazeb2.com/file/{你的-bucket-name}
```

那个 `{数字}` 在哪看？方法：
- 进入你的 bucket → 随便上传一个文件 → 点文件详情 → 看 "Friendly URL"，形如 `https://f001.backblazeb2.com/file/your-bucket/file.mp4`
- 前面 `https://f001.backblazeb2.com/file/your-bucket` 就是你的 `B2_PUBLIC_URL`

---

## 五、配置 Google 登录（可跳过）

> **不想配 Google 登录可以跳过这步**，项目支持邮箱验证码登录（需要配 SMTP，见第七步）。
>
> 但建议配一下 Google 登录，体验更好。

### 1. 进入 Google Cloud Console

打开 https://console.cloud.google.com/ 用 Google 账号登录。

### 2. 创建项目

- 顶部项目下拉菜单 → **New Project**
- 项目名随便，如 `prompt-lens`
- 创建

### 3. 配置 OAuth 同意屏幕

1. 左侧菜单 **APIs & Services** → **OAuth consent screen**
2. User Type 选 **External** → **Create**
3. 填写：
   - App name: `PromptLens`
   - User support email: 你的邮箱
   - Developer contact information: 你的邮箱
4. 一路 Save and Continue，其他可留空

### 4. 创建 OAuth Client ID

1. 左侧菜单 **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. **Authorized JavaScript origins** 添加：
   ```
   http://localhost:3000
   ```
4. **Authorized redirect URIs** 添加：
   ```
   http://localhost:3000/api/auth/callback/google
   ```
5. 点 **Create**
6. 复制保存：
   - **Client ID**
   - **Client Secret**

---

## 六、配置 AI API Key（至少选一个）

至少要配一个 AI 提供商的 key 才能用核心功能。下面三个都有免费额度，**推荐都注册一遍**。

### 1. 智谱 AI（注册送 2000 万 tokens，足够用很久）

1. 打开 https://open.bigmodel.cn/
2. 手机号注册登录
3. 点头像 → **API Keys** → **创建新 API Key**
4. 复制 key

### 2. Google Gemini（完全免费）

1. 打开 https://aistudio.google.com/apikey
2. 用 Google 账号登录
3. **Create API Key** → 复制

### 3. OpenRouter（聚合多种模型，有免费额度）

1. 打开 https://openrouter.ai/
2. 用 Google 或 GitHub 登录
3. 点 **Keys** → **Create Key** → 复制

### 4. Kie.ai（视频生成功能用，可跳过）

1. 打开 https://kie.ai/
2. 注册账号
3. 进 **API Keys** 页面创建 key

> 不配 Kie key 也能用其他功能，只是不能用"视频生成"。

### 5. AssemblyAI（音频分析功能用，可跳过）

1. 打开 https://www.assemblyai.com/
2. 注册账号（免费每月 1 小时转录）
3. 进 dashboard 复制 API Key

> 不配也能用其他功能，只是不能用"音频分析"。

### 6. DeepSeek（用于音频分析的智能分段，可跳过）

1. 打开 https://platform.deepseek.com/
2. 注册账号（送 500 万 tokens）
3. **API Keys** → 创建 → 复制

---

## 七、填写环境变量

### 1. 创建 .env.local 文件

在项目根目录执行：

```bash
cp .env.example .env.local
```

### 2. 编辑 .env.local

用 VS Code 或任何文本编辑器打开 `.env.local`，按下面说明填写：

```bash
# ===== 数据库（第三步拿到的）=====
# 方案 A（Docker）：
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prompt_analyzer
# 方案 B（Supabase）：替换成你的 Supabase 连接串
# DATABASE_URL=postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:6543/postgres

# ===== 认证密钥 =====
# 生成一个随机串：终端执行 openssl rand -base64 32
# Windows 没有 openssl 的话，随便填一个长字符串也行（仅本地用）
BETTER_AUTH_SECRET=在这里填一串随机字符比如abc123def456ghi789xyz000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
TRUSTED_ORIGINS=http://localhost:3000

# ===== Google 登录（第五步，不配可留空）=====
NEXT_PUBLIC_GOOGLE_CLIENT_ID=你的-google-client-id
GOOGLE_CLIENT_SECRET=你的-google-client-secret

# ===== Backblaze B2（第四步拿到的）=====
B2_REGION=us-west-000
B2_ACCESS_KEY_ID=你的-keyID
B2_SECRET_ACCESS_KEY=你的-applicationKey
B2_BUCKET_NAME=你的-bucket-name
B2_PUBLIC_URL=https://f001.backblazeb2.com/file/你的-bucket-name

# ===== AI 提供商（第六步，至少配一个）=====
ZHIPU_API_KEY=你的-智谱-key
GEMINI_API_KEY=你的-gemini-key
OPENROUTER_API_KEY=你的-openrouter-key

# ===== 可选功能 =====
ASSEMBLYAI_API_KEY=你的-assemblyai-key
KIE_API_KEY=你的-kie-key
DEEPSEEK_API_KEY=你的-deepseek-key

# ===== 邮箱验证码登录（不用 Google 登录的话需要配）=====
# 用 Gmail 的话：去 https://myaccount.google.com/apppasswords 生成一个应用专用密码
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=你的-gmail-邮箱
SMTP_PASS=你的-gmail-应用专用密码
SMTP_FROM=PromptLens <你的-gmail-邮箱>

# ===== 管理员邮箱（可选，用于后台管理）=====
ADMIN_EMAILS=你的邮箱@gmail.com
```

> ⚠️ **千万不要**把 `.env.local` 提交到 git！项目已经在 `.gitignore` 里排除了它。
> ⚠️ **千万不要**把这些 key 分享给别人。

---

## 八、初始化数据库 & 启动

### 1. 初始化数据库表结构

```bash
pnpm db:push
```

> 这个命令会根据代码里的 schema 自动在数据库里创建所有表。
> 如果用 Supabase，可能需要先去 Supabase dashboard 的 SQL Editor 执行一下 `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`

### 2. 启动开发服务器

```bash
pnpm dev
```

看到下面这样的输出就成功了：

```
   ▲ Next.js 15.x.x
   - Local:   http://localhost:3000
   ✓ Ready in xxxx ms
```

### 3. 打开浏览器访问

打开 http://localhost:3000 即可使用 🎉

---

## 九、常见问题

### Q1: `pnpm install` 报错 / 卡住

- 检查 Node.js 版本是不是 20+：`node -v`
- 尝试切换 npm 镜像：`pnpm config set registry https://registry.npmmirror.com`
- 删掉 `node_modules` 和 `pnpm-lock.yaml` 重新 `pnpm install`

### Q2: `pnpm db:push` 报错 "Can't reach database server"

- **Docker 用户**：检查容器是不是在跑：`docker ps`，没跑就 `docker start prompt-lens-db`
- **Supabase 用户**：检查连接串是不是正确，密码有没有 URL 编码（特殊字符要转义）

### Q3: 上传视频报 403 / 404

- 检查 B2 配置：bucket 必须是 **Private**（不是 Public）
- 检查 `B2_ACCESS_KEY_ID` / `B2_SECRET_ACCESS_KEY` 是否正确
- 检查 `B2_PUBLIC_URL` 格式：`https://f{数字}.backblazeb2.com/file/{bucket-name}`

### Q4: Google 登录跳转报错 "redirect_uri_mismatch"

- 回到 Google Cloud Console → Credentials → 你的 OAuth Client
- 确认 **Authorized redirect URIs** 里有 `http://localhost:3000/api/auth/callback/google`
- 注意 http 和 https 别搞混

### Q5: 启动后页面打不开

- 确认终端显示 `Ready in xxx ms`
- 检查 3000 端口是否被占用：`lsof -i :3000`（Mac/Linux）或 `netstat -ano | findstr :3000`（Windows）
- 换个端口启动：`pnpm dev -- -p 3001`

### Q6: 报 "Unauthorized" 错误

- 先登录！很多功能需要登录才能用
- 不登录直接用功能会一直报 401

### Q7: 想要部署到线上（Vercel）

1. 把代码推到 GitHub
2. 去 https://vercel.com 用 GitHub 登录
3. **Add New Project** → 选你的仓库
4. 在 **Environment Variables** 里把 `.env.local` 的内容全部填进去
5. **Deploy** 即可

> 注意：Vercel 的 Serverless 函数有 60 秒超时限制，长视频处理可能失败。视频剪辑功能需要自托管 FFmpeg 服务，详见项目 README。

---

## 有问题？

- 提 Issue：https://github.com/raojiacui/prompt-lens/issues
- 或者直接联系作者

祝你使用愉快！❤️
