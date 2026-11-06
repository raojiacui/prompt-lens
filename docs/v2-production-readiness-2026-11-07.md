# V2 正式上线前环境核查（2026-11-07）

## 结论与范围

用户已报告 V2 各功能测试通过，记为“用户反馈的测试站业务验收”。用户明确本轮只需要差异核查和上线准备清单。**尚不能直接切换正式站**：正式配置缺失、支付宝验签失败、旧 Worker、未核实的存储绑定及正式 OAuth 流程仍是阻塞项。本轮未修改正式配置、数据、Worker、域名或验收标记；曾额外提交到 V2 的构建与测试修改已撤回，只保留核查文档。

决策依据见 [ADR 0027](decisions/0027-v2-production-release-preparation.md)。以下为本次核查时的快照，正式发布前需重新读取，不能永久沿用部署 ID。

## 版本与环境

| 项目 | 正式站 | V2 测试站 | 判断 |
| --- | --- | --- | --- |
| Vercel 项目 | `prompt-lens` / `prj_LA38e0saqqVw1OkQ95AyoMx5vjIV` | `prompt-lens-v2-test` / `prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI` | 保持独立 |
| 固定域名 | `https://prompt-lens.cc.cd` | `https://prompt-lens-v2-test.vercel.app` | 正式回调保留正式域名 |
| Git 分支 | `main` | `prompt-lens-V2` | 不从 V2 分支向正式项目部署 |
| 核查基线 SHA | `75eb611f8759745ec743818bce24350691d6ab8d` | `5714ea8f9fcd2127f20ac01bef2b5ac61cb7f4f4` | 本轮准备提交在 V2 基线上增加 |
| 核查基线部署 | `dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV` | `dpl_bwLZ1xmJcf5VyDncLhnrvZE3QyJR` | 两者均 READY、Git 来源、匹配对应 SHA |
| Node | `24.x` | `22.x` | 有差异；本地 Node 24 构建通过，仍需统一云端版本后验证或明确保留并补测 |
| Functions | Fluid、`iad1`、basic build machine | 相同 | 配置一致，不代表负载容量已验证 |
| Supabase | `vxlwqiohliynbtjwivte`、PG 17.6.1.063 | `mwczjgflbmzgvebfilnf`、PG 17.11.0.003 | 两条 Vercel 数据库连接已脱敏核实项目归属，数据不搬运 |
| 数据库连接 | 6543 事务池；URL 未显式写 `sslmode` | 6543 事务池；`sslmode=require` | 正式发布前确认驱动 TLS 行为，不直接覆盖连接串 |
| Fly Worker | `prompt-lens-ffmpeg-worker`，10 月 15 日 v13 | `prompt-lens-v2-worker`，11 月 3 日 v4 | 正式 Worker 未包含随后修复，必须按已提交源码同步 |
| Worker 镜像 | `deployment-01M4Z3CABV1J8PWNKZQ8C0DTVA` | `deployment-01M6GDTZHVRMSQ1G388X4YR7DR` | 不同，不能只发布 Next.js |
| Worker 容量 | sin、2 台、每台 2 shared CPU / 2 GiB | sin、1 台、2 shared CPU / 2 GiB | 明确正式容量、并发和费用，再验证多机调度 |
| Worker 自动停止 | `autostop=true`，核查时 stopped | `autostop=false`，核查时 suspended | 测试版本依靠调度器空闲扫描后挂起；旧自动停止策略不能直接沿用 |

V2 与 `main` 的基线差距为 368 个提交、651 个文件。需要完整版本发布及回退安排，不能视为单个小补丁。

## 阻塞项及拟处理方案

### 1. 构建保护规则

现有 `vercel.json` 只接受测试项目，会让将来正式项目的 `main` 构建跳过。拟处理方案：测试项目保持原分支边界；正式项目只允许项目 ID、`main`、`VERCEL_ENV=production` 同时匹配。错误项目、正式项目中的 V2/其他分支、Preview 和无分支手动上传继续拒绝。判断应放在独立 shell 脚本中，避免超出 `ignoreCommand` 的 256 字符限制。两项目 `autoExposeSystemEnvs=true`，构建/安装命令均使用默认值。

这项调整留待后续明确执行，本轮恢复原规则，不合并 `main`、不发布主站。测试项目面板中的分支限制继续保留。正式发布时同时核对项目面板与仓库配置的实际生效行为。

### 2. 正式站缺失的必要配置

| 配置 | 核查结果与后果 | 发布准备要求 |
| --- | --- | --- |
| `EASYDOWN_API_KEY` | 正式站无此变量；链接导入会报服务未配置 | 从批准的正式服务凭据来源补齐，实测解析、保存与成功计次 |
| `SMTP_FROM` | 正式站无此变量；新邮件模块会在登录前预检中拒绝缺失配置 | 设置与 SMTP 服务授权匹配的发件地址，验证 SMTP、验证码送达及登录 |
| `COMMERCIAL_CONSUMPTION_ENABLED` | 正式站缺失，V2 为 `true` | 正式依赖就绪后按 V2 已验收行为配置，不用关闭付费路径换取通过 |
| `COMMERCIAL_REWRITE_ENABLED` | 正式站缺失，V2 为 `true` | 验证正式套餐权益、预留/结算及失败恢复后启用对应路径 |
| `COMMERCIAL_REVIEW_ALERT_EMAIL` | 正式站无此变量 | 配置负责人地址，连同 `SMTP_FROM` 验证实际复核提醒 |
| `COMMERCIAL_SCHEDULER_ACCEPTED` | 正式站为 `false`，V2 为 `true` | 先验证正式 Worker 的鉴权、回调、任务扫描、恢复与挂起，再更新证据标记 |

不能把测试变量整包覆盖正式项目。正式数据库、认证密钥、存储、Worker 密钥与回调均须保留正确归属。

以下缺失不直接等同故障：正式 `DATABASE_MAX_CONNECTIONS` 缺失时源码默认 5，与测试值一致；`SMTP_SECURE` 缺失时按端口推断，正式端口为 587；邮件站点地址可回退到正式 `NEXT_PUBLIC_SITE_URL`；欢迎邮件缺省关闭，与测试的 `false` 一致。仍应在最终配置清单中明确这些行为。`ADMIN_EMAILS` 的差异不作为开放管理权限的依据，当前管理员策略以源码所有者邮箱为准。

### 3. 支付宝验签失败

- 两边应用 ID 与商户私钥相同，支付宝公钥不同；去除 PEM 包装及空白后仍不同。正式与测试使用同一个正式支付宝网关，`ALIPAY_SANDBOX=false`。
- 使用各自配置执行 `alipay.trade.query`，随机查询不存在的订单，并开启 `validateSign=true`。测试返回 `40004 / ACQ.TRADE_NOT_EXIST` 且验签通过；正式配置抛出与签名相关的 `AlipayRequestError`。
- 本次只查询，没有创建订单、付款、关闭订单或退款。
- 发布前必须从支付宝控制台核正公钥并做相同只读复验，再验证真实付款到账、回调验签、幂等、取消/退款及对账。不能将验签关闭或直接复制未核实的密钥作为修复。
- 两边均未配置 `COMMERCIAL_PAYMENT_ACCEPTANCE`、`COMMERCIAL_MODEL_ACCEPTANCE`。用户反馈的测试通过保留为验收反馈；补充对应订单/任务证据后再决定是否填写当前 `PRICING_VERSION=2026-09-14-v6`。不批量填写已通过标记。

### 4. Worker、平台模型和密钥

- 正式 Worker 比测试镜像旧，源码在 10 月 22 日、27 日、11 月 3 日继续修改过调度、存储校验与瞬时下载恢复。需要先推送批准的发布源码，再单独更新正式 Worker；Vercel Git 构建不会自动更新 Fly。
- 正式 Worker 的回调基址、鉴权和 Cron 密钥必须指向正式项目并成对匹配。Vercel 的正式 Worker 地址与部分密钥标为 sensitive，不能回读；本轮只确认变量存在，不声称已匹配或有效，不尝试绕过平台限制。
- 两边 `KIE_API_KEY` 不同，正式 `KIE_API_BASE_URL` 和模型变量为不可回读的 sensitive。需在正式运行环境验证服务地址、余额、模型权限、实际交付及结算；变量存在不代表调用成功。
- 正式无 `BYOK_ENCRYPTION_KEY`，源码会回退使用正式 `BETTER_AUTH_SECRET` 派生解密密钥。**保留现有正式认证密钥和回退路径**；直接加一条随机 BYOK 密钥或复制测试密钥会导致旧 API Key 无法解密。会话密钥也不能从测试复制。

### 5. R2 绑定、清理和样例

- Fly 两个应用的 R2 账号、访问凭据、桶名及公开地址的 secret digest 分别相同；Worker 鉴权密钥和对账 Cron digest 不同。R2 桶变量名称不同（正式 `R2_BUCKET`，测试 `R2_BUCKET_NAME`），源码支持两种名称。**两个 Worker 的存储配置尚未体现桶级隔离**，需要核实实际桶归属、清理范围和密钥权限，不能假设测试数据完全隔离。
- 正式与测试 Vercel 的 R2 变量标为 sensitive，未回读。本地唯一 `.env.local` 指向 `promptlensdev`；只读检查此桶已包含正式和测试域名的 CORS，两个域名的浏览器式 `OPTIONS` 均返回 204，并返回匹配的 allow-origin 和 `GET, PUT, HEAD`。
- 上述结果**仅证明本地所配桶的 CORS**，不能证明正式 Vercel 签名凭据或正式上传完整可用。本轮未上传/删除任何对象。最终确认正式绑定后，还须验证正式页面实际取得的 presigned PUT、上传后的 HEAD 和后续读取；必要的 CORS 修改必须保留既有生产来源。
- 公开快照共有 10 个样例，446 条去除片段参数后去重的 HTTPS 引用全部指向 `pub-838ceb4cc82146c2b99d5f06b4751da6.r2.dev`。正式发布仍依赖这些资产；不要在发布后清空测试桶或替换公开地址。
- 新版清理器会保护静态样例并查询本环境数据库引用，不会查询另一个数据库。任何共享桶对象、跨环境复制引用和旧版清理器都需要核对；桶级隔离或清晰的对象所有权方案未确认前，不进行跨环境迁移或清理。

### 6. 登录及正式回调

- 测试白名单恰好为 `raojiacui@gmail.com`、`raojinbo@gmail.com`；正式未配置白名单，属于公开站行为，不能将测试白名单复制到正式站。
- 当前测试 UI 与 API 在白名单模式下只支持邮箱验证码，并拒绝 `/api/auth/sign-in/social`。测试站通过不包含正式 Google/GitHub OAuth 完整链路。
- 正式两种 OAuth 凭据均有配置；测试缺 GitHub 凭据，Google 凭据与正式不同。需在提供方控制台核对正式回调 `/api/auth/callback/google`、`/api/auth/callback/github`，实际登录、退出、会话刷新后继续任务。
- 两边 site/auth 基址、支付宝通知与应用对账基址已分别匹配各自域名。正式邮件链接、Worker 回调与提供方控制台回调仍需完整实测。

## 数据库核查

- 两库均为 38 张 public 表，列的类型、UDT、默认值和可空性完全一致；124 个索引、103 项约束及 532 项表授权逐项一致；public 表无业务触发器和 RLS policy，全部开启 RLS。
- 表授权仅见 `postgres` 与 `service_role`，未见 `anon`、`authenticated` 或 PUBLIC 表授权。RLS 无 policy 对应仅服务端连接的既有设计，不为消除提示添加客户端权限。
- 正式多装一个 `pg_net 0.19.5` 扩展；安全顾问提示位于 public。记录为既有安全维护项，未在本轮迁移扩展。顾问无其他 WARN/ERROR，双方均有 38 条 RLS 无 policy 的 INFO。
- 迁移历史不一致：正式 Supabase 记录 0016–0019 及一次 harden，另有 Drizzle 迁移表；测试记录 0000–0024，无 Drizzle 迁移表。**不能按历史条数判断缺表，也不能直接重跑迁移**。本轮未执行任何 DDL 或数据迁移。
- `db:check-v2` 目前只检查到 0019，不能单独作为 0024 的完整验收。发布前保存结构快照、核实备份可恢复性及迁移记录对齐方案；已有用户、订单、余额及新旧积分账本保持原库。
- PG 小版本不同；本轮不升级数据库。备份/PITR 的可用性和恢复演练未核实，保留为正式发布前检查项。

## 本地验证及测试交付

- `npm run build`：通过（本机 Node 24.13.0）；未部署正式项目。构建提示本地缺 GitHub OAuth 凭据，符合上述测试差异，未隐藏警告。
- 拟定的构建保护方案曾通过实际 Git Bash 的 15 项矩阵及 1 项命令长度校验。用户澄清范围后已撤回该方案代码与测试，本轮仅保留建议，不据此声称当前规则允许正式构建。
- 原商业化配置诊断有 1 项失败，原因是测试夹具漏填提醒邮件配置。补齐夹具后的 7 项曾通过；本轮额外测试修改已撤回，保留为后续维护项，未调整产品验证。
- 原 Vitest 会收集 `tmp/` 中临时 checkout 的重复测试；排除临时目录的建议待后续执行，本轮未保留测试配置调整。
- 测试库商业任务 `queued/running/review` 聚合计数均为 0（仅本次查询时点）；正式发布时需重新检查活动任务及预留。
- 临时核查脚本、输出、截图、缓存和本地 `.env.local` 不纳入提交；已有无关工作区修改保持原样。
- 首次额外准备提交 `a1a005f` 的 Git 自动部署被配置校验拒绝：内联 `ignoreCommand` 超过 256 字符。用户澄清范围后以正常后续提交撤回额外代码，仅保留文档；失败部署未接管固定域名。更正结果以远端提交及固定域名回读为准，不重写历史。

## 正式发布顺序（待阻塞项解决及明确上线授权）

1. 固定待发布 Git SHA，重新核对远端分支、项目 ID、域名与旧应用/Worker 镜像；确认正式备份与恢复方案。整理并审核逐项配置变更，保留现有密钥和数据，禁止复制测试环境整包。
2. 核正支付宝公钥；补齐必要服务与邮件配置；确认平台模型、R2、OAuth、正式回调、后台调度和商业验收证据。统一 Node 或补齐保留差异的验证。任何失败继续阻塞上线。
3. 核对现有钱包和旧积分的兼容行为；配置清理对象归属及公开样例保留。数据库仅在发现实际结构差异且完成审核后执行最小迁移。
4. 对正式 Worker 的更新先确认与旧应用的兼容性、当前活动任务及恢复能力，再按已推送源码发布，保留 v13 镜像；需要窗口时明确停止接收新任务的操作方案，不能直接中断已付费任务。
5. 在获准上线后通过审核的 Git 合并将确切版本送入 `main`，由正式项目 Git 集成自动部署。根目录 `.vercel/project.json` 保持 V2 测试绑定，不运行 CLI 生产上传或手动提升。
6. 核对远端 `main` SHA、正式 Git 来源部署 SHA、项目 ID、READY 状态和 `prompt-lens.cc.cd` 指向。测试站继续跟踪 V2，白名单和独立数据库保持原样。
7. 正式域名受控验收：邮箱与 OAuth 登录、浏览器真实上传、链接导入、首镜头/后台恢复、平台与 BYOK 分析、改写、套餐权益、真实支付到账与幂等、退款/对账、样例媒体及七天清理。逐项记录任务/订单证据，不预填通过标记。

## 回退边界

发布窗口前重新记录正式应用部署 ID、Git SHA、Worker 镜像及已批准的配置变更。回退必须覆盖应用、Worker 与配置的兼容关系，并保护已提交任务与支付回调；禁止删除新订单、账本、预留和用户数据来恢复旧状态。常规回退按仓库流程提交并推送 `main` 触发 Git 部署；紧急人工回滚/提升属于单次例外，需要明确授权。仅回退网页不足以恢复 Worker 和配置，备份也不能直接覆盖发布后新增的商业数据。
