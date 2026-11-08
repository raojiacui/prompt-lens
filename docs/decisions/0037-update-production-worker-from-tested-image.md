# ADR 0037：使用已验收的同一镜像更新正式 Worker，调度分阶段启用

- 日期：2026-11-08
- 状态：正式 Worker 已更新并通过媒体探针验证；正式调度及 Web 联动仍待发布窗口验收。
- 关联：ADR 0031、0035、0036；上线过程记录第 007 项。

## 背景

负责人在比较复用测试 Worker 和更新正式 Worker 后，明确要求“更新一下正式 worker，要确保和测试 worker 一模一样”。沿用独立正式/测试应用，以测试应用当前已验收的不可变镜像更新正式应用，避免重新构建引入依赖差异。

本次只发布 Fly 正式 Worker，不发布 V2 Web、不切换 GitHub 默认分支或 Vercel 跟踪分支。GitHub V2 已包含对应 Worker 源码，远端 SHA 为 `aa11e5c4cd079400e6aa36c16f371cbb9cde6610`，相关源码与本地一致；没有通过 CLI 上传尚未推送的新应用源码。

## 决策

- 目标限定为 `prompt-lens-ffmpeg-worker`；复用 `registry.fly.io/prompt-lens-v2-worker@sha256:bc949557ff9d5306e01a220d90cd8345ac78f2ae0e464d4a5de7179e77a99e62`，不重新构建，不更新测试应用。
- 正式运行规格对齐测试：1 台 sin、2 shared CPU / 2048 MiB，soft/hard 并发 1，自动启动开启、最小运行数 0、Fly Proxy 自动停止关闭。用户要求与测试一致，包含本次从两台调整为一台；保留旧镜像和配置记录作为恢复基线。
- 程序镜像及运行参数一致，环境归属分别配置：正式 `R2_BUCKET_NAME=prl`、`R2_PUBLIC_URL=https://pub-93c2334144db44c1b97cb34effed3a19.r2.dev`。移除旧 `R2_BUCKET` 名称以消除两个桶变量的优先级歧义，保留正式 R2 访问凭据、Worker 鉴权密钥及 Cron 密钥。
- 先暂存移除 Fly 的 `COMMERCIAL_RECONCILIATION_BASE_URL`，再应用新镜像，使用源码已有门控保持正式调度未启用。旧正式 Web 尚无目标回调路由，且正式库有待支付及清理记录；不得提前扫描。正式 Web 切换后恢复正式回调地址并验证调度，才讨论更新 `COMMERCIAL_SCHEDULER_ACCEPTED`。
- 使用精确镜像引用部署，验证镜像 digest、机器数量/规格、配置及正常鉴权；在正式 Worker 内使用其运行时凭据进行临时媒体存储探针，不输出密钥。只处理专用合成素材及本次创建的对象，清理后挂起正式机器。
- 不修改 Vercel 正式密钥或变量、不启用商业验收标记、不创建支付订单或调用收费解析/模型。Web 与 Worker 正式密钥配对的端到端验证仍留待正常登录态发布验收。

## 备选方案

- 从源码重新构建：依赖范围可能解析到不同版本，不满足此次尽量与已测镜像一致的目标，改用同一 digest。
- 把测试应用直接转正式：会占用仍用于验证的测试环境，不采用。
- 更新时立即开启正式调度：会提前触达旧站或业务记录，不采用；调度未启用仅作为发布准备阶段，不能据此宣称完整上线验收通过。

## 执行及验证

- 正式 Fly Release **v14** 于 2026-11-08 21:37:33（Asia/Shanghai；13:37:33 UTC）发布，状态 complete。直接指定测试镜像 digest 部署，没有重新构建；正式和测试实际运行的镜像摘要均为 `sha256:bc949557ff9d5306e01a220d90cd8345ac78f2ae0e464d4a5de7179e77a99e62`。
- 已对齐为 1 台 sin、2 shared CPU / 2048 MiB。保留机器 `2874974f710538`，缩容移除 `48ee713c373778`；实际机器的 env 配置、guest 规格及 services 配置与测试逐项比较一致。Fly Proxy autostop=false、autostart=true、min=0、并发 soft/hard=1。
- 原 R2 账号/访问凭据、`WORKER_SECRET`、`CRON_SECRET` 的摘要保持不变。正式采用 `R2_BUCKET_NAME=prl` 及正式公开域名，旧 `R2_BUCKET` 已移除；Worker 运行时探针确认其实际使用 `prl` 和正确公开地址。
- Fly 回调地址已先 staged 移除并随部署生效。健康接口确认 `reconciliationScheduler.enabled=false`；正常鉴权的 `/scheduler/wake` 返回 200、`scheduled=false`，没有触发正式扫描。Cron 密钥保留，正式 Web 的验收标记保持原状。
- 部署后第一次机器列表仍短暂显示 replacing 及旧镜像快照，后续只读复查确认替换已完成。没有因这一过渡快照重复部署或回滚。

### 实际媒体验证

- 2026-11-08 21:42–21:43（Asia/Shanghai），通过正式公网 `/healthz` 唤醒 Worker，返回 200；随后在正式机器中执行不输出密钥的诊断程序，使用应用自身运行时凭据验证服务。
- 未授权 `/ingest-media` 返回 401；正常鉴权的空请求返回 400 / Missing videoUrl，证明鉴权和必需配置检查生效。此项没有读取或导出鉴权密钥，也不等同于正式 Web 与 Worker 的端到端配对验证。
- 以 FFmpeg 生成 2 秒、320×180、带音频的合成 MP4（21,004 字节），只上传到本次独立的 diagnostics UUID 路径，不使用用户素材。
- 正式 `/commercial-media` preview 返回 200，时长 2,000,000 微秒、1 个镜头、音轨存在，检测器为 **pyscenedetect / adaptive**。
- assets 返回 200，生成 1 段视频、3 张关键帧及 1 段音频。5 个输出均在 `prl`，S3 HEAD 内容长度非零，公开 HEAD 均返回 200。
- 源视频及 5 个输出共 **6 个对象全部删除，并逐项用 S3 HEAD 确认 404**；临时本地合成目录也已清理。没有调用 EasyDown 或 AI 模型，没有支付、业务任务或数据库写入。
- 完成后明确调用 Fly suspend。21:45:25（Asia/Shanghai）的最终只读核对：正式机器为 **suspended**，镜像与测试相同；测试机器状态、镜像和所有密钥摘要/部署状态与操作前一致。

### 环境边界及后续事项

- 程序和机器运行参数已与测试一致。正式桶、公开域名和独立鉴权配置属于环境差异；正式调度在本次准备阶段有意保持未启用，不声称完整调度链路已验收。
- 本轮验证公网唤醒、实际媒体处理及手动挂起；连续三次空扫描自动挂起、正式 Web 配对、关闭浏览器后任务推进、回调、保留期及清理队列执行，留待正式 V2 Web 上线后验证。届时恢复 `COMMERCIAL_RECONCILIATION_BASE_URL=https://prompt-lens.cc.cd`，先确认既有订单及清理项处理范围，再应用配置并验收；不能遗忘该恢复步骤。
- 镜像仍引用测试应用的 registry 仓库。保持测试镜像仓库可用；将来删除测试 Fly 应用或清理其镜像前，先按相同 digest 复制并验证正式镜像仓库，避免丢失正式应用的拉取来源。
- 容器实际 Node 为 20.20.2，本次遵循同一已测镜像保留运行时，未顺便升级基础镜像或依赖；后续运行时升级另行构建、测试与发布。
- 正式 Web 域名复查仍指向 `dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV`，未触发 Vercel 发布；工作区仍绑定唯一 V2 测试项目。没有改动 GitHub 分支、Vercel 变量、商业验收标记或测试 Worker。
- 更新前方案已本地提交 `de6c2c2`；对应 Worker 源码早已在 GitHub V2 `aa11e5c`，本轮只部署既有镜像。执行脚本、探针、脱敏日志留在忽略的 `temp/`；后续仅本地提交执行记录，不为文档额外推送 V2 触发测试部署。
