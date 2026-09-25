# Prompt Lens V2 本地启动

## 准备

- Node.js 20+、pnpm、PostgreSQL。
- 一个 Cloudflare R2 bucket，以及有读写权限的 R2 API Token。
- 一个 KIE API Key。平台免费试用、管理员和已购买平台套餐的模型调用使用服务端 KIE Key；普通用户可在设置中填写自己的 KIE Key。
- 视频拆镜需要单独部署 FFmpeg worker。

## 配置

复制 `.env.example` 为 `.env.local`，至少填写：

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/prompt_analyzer
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
TRUSTED_ORIGINS=http://localhost:3000

R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_PUBLIC_URL=https://your-r2-public-domain

KIE_API_KEY=your-kie-api-key
BYOK_ENCRYPTION_KEY=your-32-byte-compatible-secret
FFMPEG_WORKER_URL=http://localhost:8080
FFMPEG_WORKER_SECRET=replace-with-a-worker-secret
```

在 R2 bucket 的 CORS 规则中允许本地来源 `http://localhost:3000` 和实际生产站点来源直接 `PUT`，并允许 `Content-Type` 请求头。前端向 `/api/upload` 获取预签名地址后直接上传至 R2；上传失败会返回错误，不会改走应用服务器。`R2_PUBLIC_URL` 要与绑定的 R2 公共域名一致。

邮箱验证码登录需要配置 `.env.example` 中的 SMTP 参数。Google/GitHub 登录则需要对应 OAuth 参数。

## 启动

```powershell
pnpm install
pnpm db:migrate
pnpm dev
```

另起终端启动 FFmpeg worker，参见 `workers/ffmpeg-worker/README.md`。首次部署或更新代码后先运行数据库迁移；试用次数的原子计数依赖 `0016_trial_analysis_usage.sql`。

## 验证

1. 在设置页保存自己的 KIE API Key，或用没有 Key 的新账号检查两次免费试用。
2. 上传短视频，确认浏览器请求直接 `PUT` 至 R2，随后 `/api/upload/complete` 返回成功。
3. 免费试用应固定显示 Gemini 3.8 Flash；试用用完后，服务端应拒绝继续使用平台试用 Key。

上传出现 403/CORS 错误时检查 bucket CORS 来源、`PUT` 方法、`Content-Type` 请求头和 R2 凭据。上传完成校验失败时检查 R2 对象大小、bucket 和 `R2_PUBLIC_URL` 是否对应。
