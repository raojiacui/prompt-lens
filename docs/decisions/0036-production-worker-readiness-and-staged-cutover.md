# ADR 0036：只读核对正式 Worker，并将调度启用纳入发布窗口

- 日期：2026-11-08
- 状态：只读核查及本地源码准备完成；负责人随后授权更新正式 Worker，执行方案与结果转至 ADR 0037，本记录保留核查时快照。
- 关联：ADR 0001、0027、0031、0035；上线过程记录第 006 项。

## 背景

负责人要求继续上线准备。本项核对正式 Worker 的版本、存储、回调、鉴权及调度差异，不将“下一步核对”扩展为启动服务、缩容、变更密钥或部署。负责人此前确认旧正式站未使用 Worker。

当前正式 Worker 比测试版本旧，既有正式 Web 提交还没有 `/api/cron/commercial-reconciliation` 路由；新版 Worker 的调度器在回调地址和 Cron 密钥同时存在时，会在启动后约 1 秒发起第一次扫描。直接更新并启用会产生回调失败，正式 Web 切换后还会处理已有业务记录，必须安排明确启用顺序。

## 已执行的决定

1. 只通过 Fly 管理接口读取机器、镜像、发布记录、应用配置以及密钥名称/摘要/部署状态。不启动 Machine，不通过 HTTP 健康检查唤醒已停止服务，不进入运行时读取密钥。
2. 读取 Vercel 相关变量元数据及可回读的非敏感回调配置，不请求 sensitive 值，不把变量存在或不同服务的摘要当作密钥配对证明。
3. 从 GitHub 已推送的确定 V2 提交制作本地 Worker 源码 ZIP，记录原镜像及机器配置，运行已有本地测试；不构建远程镜像、不推送镜像、不执行服务更新。
4. 保持正式 `COMMERCIAL_SCHEDULER_ACCEPTED=false`，真实调度与正式链路验证完成后再讨论更新验收标记。

## 当前状态

| 项目 | 正式 Worker | 测试 Worker |
| --- | --- | --- |
| 应用 | `prompt-lens-ffmpeg-worker` | `prompt-lens-v2-worker` |
| 最新 Release | v13，2026-10-15 06:19 UTC | v4，2026-11-03 10:05 UTC |
| 机器 | 2 台，均 stopped | 1 台，suspended |
| 地区和单机规格 | sin，2 shared CPU / 2048 MiB | 相同 |
| Fly Proxy 自动停止 | `true` | `false` |
| 自动启动 / 最小运行数量 | `true` / 0 | `true` / 0 |
| 并发限制 | soft 1 / hard 1 | 相同 |
| Worker / Cron 密钥 | 名称存在，状态 Deployed | 名称存在，状态 Deployed；摘要分别与正式不同 |
| Worker 回调地址 | 名称存在，值不可回读 | 名称存在，值不可回读；摘要与正式不同 |
| 存储密钥 | `R2_ACCOUNT_ID`、访问凭据、`R2_BUCKET`、`R2_PUBLIC_URL` 均存在 | 对应项存在，桶变量名为 `R2_BUCKET_NAME`，另有 `R2_ENDPOINT` |

- 两个 Fly 应用的 R2 账号、访问凭据、桶名和公开 URL 的对应摘要相同。只能记录这一事实，不能据此断定正式 Worker 已配置为 `prl`；正式 Web 和测试 Web 的桶归属按第 005 项单独核验。更新正式 Worker 时必须明确设置生产桶及地址，不能复制测试整套配置。
- 正式 Vercel 的 `FFMPEG_WORKER_URL`、`FFMPEG_WORKER_SECRET`、`CRON_SECRET` 均存在但为 sensitive；没有验证其值或与 Fly 的配对。可回读的 `COMMERCIAL_RECONCILIATION_BASE_URL=https://prompt-lens.cc.cd`，`COMMERCIAL_SCHEDULER_ACCEPTED=false`。
- 测试 Vercel 可回读的 Worker 地址为 `https://prompt-lens-v2-worker.fly.dev`，回调基址为测试域名，调度验收标记为 true。Web 的回调变量正确不代表 Fly 中同名 secret 已匹配。
- 正式库只读统计：9 笔 pending 支付订单、1 条 pending 素材清理记录、1 条 review 商业任务；未发现 queued/running 商业任务或场景任务。没有读取订单或素材明细，没有恢复、关闭、扣款、发通知或清理任何记录。启用时需重新统计并确认处理范围。

## 已准备的源码和回退基线

- GitHub `prompt-lens-V2` 远端本次实读 SHA 为 `aa11e5c4cd079400e6aa36c16f371cbb9cde6610`。本地 Worker 源码和 `fly.ffmpeg-worker.toml` 与该提交无差异；最后涉及 Worker 的源码提交为 `81eda36`（11 月 3 日）。没有据日期推断已部署镜像与源码逐字节匹配。
- 本地包：`temp/worker-v2-release-source-aa11e5c.zip`，只归档 `.dockerignore`、`fly.ffmpeg-worker.toml`、`workers/ffmpeg-worker/`；ZIP 完整性通过，18 个文件/目录条目均在允许范围内，无工作区环境文件。
- 源码 ZIP SHA-256：`45cd2804d605e3622f11a63a588b63c59d329f62782f80e7191555c8ab58cbeb`。源码包不等于已验证的容器镜像；构建后必须固定镜像 digest 并验证实际容器。
- 正式旧镜像：`registry.fly.io/prompt-lens-ffmpeg-worker:deployment-01M4Z3CABV1J8PWNKZQ8C0DTVA`，digest `sha256:27a3a80c5821ad93992e817535616373f90faaec8409f1671f202ad5f93d8bd8`。
- 正式机器 ID：`48ee713c373778`、`2874974f710538`；当前均 stopped、v13、同一镜像。记录用于后续恢复核对，本项没有实施回退。镜像记录不替代密钥及配置恢复来源，也不承诺注册表永久保留镜像。
- 测试镜像 digest：`sha256:bc949557ff9d5306e01a220d90cd8345ac78f2ae0e464d4a5de7179e77a99e62`；只作验收环境基线，不直接提升或部署到正式应用。

## 拟议更新顺序（待确认，全部未执行）

1. **准备阶段只构建镜像**：基于已推送 GitHub 的确定源码构建，标注 Git SHA、记录不可变镜像 digest；可使用经 CLI help 核实的 `--build-only --push` 只构建并推送镜像，不更新应用机器。实际构建需另行明确执行，避免误把普通 `fly deploy` 当作准备命令。
2. **发布窗口前核对配置来源**：正式预期绑定为 `R2_BUCKET=prl`、公开地址 `https://pub-93c2334144db44c1b97cb34effed3a19.r2.dev`；检查不存在优先级更高、指向其他桶的 `R2_BUCKET_NAME`。正式 Web 的 Worker 地址应指向 `https://prompt-lens-ffmpeg-worker.fly.dev`。`WORKER_SECRET` 对应 Web 的 `FFMPEG_WORKER_SECRET`；`CRON_SECRET` 在两端一致且继续与测试隔离。敏感值通过负责人可信来源注入，不能从测试照搬。
3. **明确容量后更新服务**：建议先与已验收机制一致采用 1 台 sin、2 shared CPU / 2 GiB，并设 `auto_stop_machines=off`、`auto_start_machines=true`、`min_machines_running=0`。缩至单机会减少并行容量和冗余，需要负责人确认；若保留两台，须单独验证多机调度及挂起行为。本次不擅自缩容。
4. **Web 切换前保持正式调度未启用**：若先部署预备 Worker，先分阶段移除其回调地址注入，使源码已有的调度门控保持 disabled；Fly `secrets unset --stage` 和 `secrets set --stage` 的行为已通过 help 核实，但本次未调用。此阶段只做健康、鉴权和微小存储探针，不记为调度验收通过。不得启动新 Worker 向旧 `main` 的缺失接口反复扫描。
5. **按第 001 项切换正式 Web**：构建保护、登录与其他前置项均就绪后，在最终发布窗口通过 Git 集成切换到确定 V2 提交。此时核对正式域名、Git SHA 和部署来源，旧 `main` 保留。
6. **启用并验证正式调度**：再次统计待处理订单、复核和清理队列，确认其处理范围；恢复 Worker 回调基址为 `https://prompt-lens.cc.cd` 并应用正式 Cron 密钥配对。更新配置会引起服务重启，须纳入同一发布窗口。验证正常鉴权、回调 200、关闭浏览器后任务推进、完成后连续三次空扫描挂起，再验证新任务唤醒；验证前不填写验收标记。
7. **验证存储和业务**：正常正式登录态的上传完成回执、`prl` 下载/拆镜/输出、任务进度、失败恢复、保留期与引用保护均需证据。最后再进行已授权的真实支付和模型验收；健康检查不能替代这些流程。

上述分阶段调度门控用于隔离上线准备与现有正式站，正式发布时必须恢复预期功能；不得以保持 disabled 的状态宣称验收通过。

## 备选方案

- 立即在正式应用运行新 Worker：旧 Web 缺少调度目标路由，且正式库已有待处理记录，本次不执行。
- 保持 Fly Proxy 的旧自动停止策略：可能在后台仍有工作时停止机器，不直接沿用；正式更新时采用源码已有的任务扫描后挂起机制并验证。
- 整包复制测试存储与密钥：会混淆生产桶及鉴权边界，不采用。
- 只部署 Web：Fly 不随 Vercel Git 集成自动更新，无法取得已验收的 Worker 修复，不采用。

## 验证与影响

- 本地 Node 原生测试 12 项通过；Vitest 当前仓库 6 个相关文件、49 项通过。首次误用 Node 运行了部分 Vitest 文件，纠正后按各自运行器重测；Vitest 排除 `tmp/` 重复副本后记录准确计数。未修改测试或产品源码。
- 检查覆盖调度、挂起、分镜时长、下载恢复、存储 URL 边界、远端编码预检和 Web 唤醒请求；本地宿主测试不等同于正式 Fly 镜像验收。
- 未启动或 SSH 进入机器，未发起 Worker HTTP 请求，未构建/推送镜像，未改密钥、机器数量、自动停止策略、Vercel 配置、验收标记、业务数据或部署。
- 临时诊断结果、测试日志和源码包置于被忽略的 `temp/`；仅本地提交本 ADR 和上线记录，不额外推送 V2 触发测试部署。
