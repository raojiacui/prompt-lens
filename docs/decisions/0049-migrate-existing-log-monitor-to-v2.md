# ADR 0049：将既有正式日志邮件巡检迁入 V2

- 日期：2026-11-09
- 状态：本地迁移、验证、GitHub V2 推送及 Git 测试部署核验完成；默认分支切换后的 schedule 运行和邮件实际送达仍待验收。
- 关联：ADR 0031、0048；上线记录第 019 项。

## 背景

负责人明确要求现在迁移原有半小时 Vercel 日志巡检。原巡检存在于 main 的旧正式提交 75eb611f8759745ec743818bce24350691d6ab8d，V2 缺少工作流及配套脚本。GitHub 定时工作流从默认分支运行，最终将默认分支改为 V2 前必须补齐文件。

## 决策

- 只从已核实的旧正式提交迁入 .github/workflows/vercel-log-email-monitor.yml、scripts/vercel-log-report.mjs、tests/vercel-log-report.test.mjs 和 docs/operations/vercel-log-email-monitor.md，不合并 main、不切换默认或正式部署分支。
- 保留固定正式项目 ID、production 过滤、error/fatal 与 5xx 查询、滚动 30 分钟窗口、每小时第 7/37 分钟计划和异常邮件/正常静默行为。监控不固定 main 分支，因此正式项目改为 V2 后继续查询同一正式项目的生产日志。
- 工作流使用 Node 24，与本次 V2 的 Node 选择一致；Vercel CLI 65.2.0、nodemailer 8.0.4 及两个 Actions 完整提交固定值保留。报告中删除 QQ 专属的 SMTP 测试文案，继续使用通用配置。
- 仅保留 contents: read，checkout 不持久化凭据，无 push 触发或部署步骤；仓库级 Actions Secrets 沿用原名称，不读取其值或复制 Vercel 项目凭据。此次不手动 dispatch、不新增发信或触发正式业务。
- 修正旧操作文档的每日两次、固定长窗口和 main 过滤描述。说明当前实际调度间隔有缺口；迁移不等于解决 GitHub 调度延迟，不扩大到此前已失败的保留期外窗口。
- 按本地验证、提交、推送 prompt-lens-V2、Git 集成自动部署唯一测试项目的约定执行，再核对远端 SHA、部署来源 SHA、测试域名和正式旧部署 ID。

## 备选方案

- 保持只在 main：默认分支改为 V2 后会失去计划工作流，不采用。
- 将 main 整体合入 V2：扩大迁移范围且与分支保留安排不符，不采用。
- 为 V2 新建另一套同时运行的巡检：重复采集、重复通知，无需采用。
- 为获得运行证据立即手动触发邮件工作流：会发送真实邮件，超出本轮迁移范围；默认分支切换及真实通道验收另行执行。

## 本地验证

- Node 24.13.0 下脚本语法检查通过；已有 Vitest 回归共 10 项通过，覆盖 typed JSONL 解析、分页摘要忽略、异常数据拒绝、日志筛选、跨查询去重、聚合、静默及测试摘要、CLI 查询与窗口配置。
- 原测试对 Bash 多行内容含 LF 的判断在 Windows 读到 CRLF 时会失败；仅在相应断言前归一化换行，保持实际检查内容。
- YAML 结构解析通过：仅 schedule/workflow_dispatch、计划表达式、Node 24、正式项目 ID、contents: read、checkout 凭据禁用和 Actions 完整提交固定值均符合要求。
- 此次不修改应用路由、页面、数据库或 Worker，无需重复本地 Web 构建；测试 Git 集成仍会执行正常云端构建，不绕过。
- 首次测试因沙箱 esbuild 子进程 EPERM 未启动；按权限要求重跑后通过，不归因于业务失败。

## 后果及后续验证

- 迁移文件推送到 V2 后，默认分支仍为 main，原 schedule 继续从 main 运行。最终默认分支切换后再确认 schedule 的 head_branch/head_sha 和云端步骤，不能把测试站 Web 部署成功视为 GitHub 邮件巡检已在 V2 实跑。
- 最近计划运行相隔数小时，仅查询最近 30 分钟存在覆盖缺口；调度原因及是否需要更可靠的触发来源继续保留待办，不在本轮引入新平台或费用。
- 仍不覆盖 Fly 独立日志或无新日志的失联场景。SMTP 接受、用户实际收到及巡检自身失败告警分别验证，不提前记录为通过。
- 本次推送包含此前已本地提交的上线记录及旧密钥兼容测试；未提交工作区无关 ADR 0001 修改或 R2 辅助脚本。远端及部署核验完成后补充执行结果。

## 默认分支切换后的执行核验（2026-11-13）

- 负责人已将默认分支改为 prompt-lens-V2，并亲自手动运行巡检。GitHub API 核验运行 43431705684：workflow_dispatch、prompt-lens-V2 / b9bd3dd，completed/success；Node 24、正式日志采集和通知判断步骤均成功。
- 此结果只证明 V2 手动运行及现有日志查询路径可用，不代表计划任务连续覆盖或异常邮件实际送达；schedule 接续与 ADR 0050 的延迟缺口仍待观察及后续处理。助手未手动触发任何工作流或发信。

## Git 推送与部署核验

- 功能提交 [31e99f05fe57ef9566bec77d399b20c61505b4b2](https://github.com/raojiacui/prompt-lens/commit/31e99f05fe57ef9566bec77d399b20c61505b4b2) 先完成本地验证及提交，再推送 origin/prompt-lens-V2；远端实读 SHA 一致，GitHub 固定提交的工作流文件已确认存在。
- 2026-11-09 23:43（Asia/Shanghai），测试域名 prompt-lens-v2-test.vercel.app 对应 dpl_3sNpkX11WoxMV7EA7frB78hHrnbo（READY）。来源为 git / GitHub prompt-lens-V2，gitSource.sha 和 githubCommitSha 均为上述功能提交，未通过 CLI 上传或手动提升。
- 匿名只读检查：/login=200、/api/auth/ok=200 且认证健康正文正常、/samples=307 到登录页，符合邀请白名单；没有以此宣称完整业务验收通过。
- 迁移前后正式域名仍为 dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV，main 远端仍为 75eb611f8759745ec743818bce24350691d6ab8d，GitHub 默认分支仍为 main。未修改正式项目部署来源、环境变量、Secret、Worker 或业务数据，未发邮件。
- GitHub Actions 在 V2 上的 schedule 接续需等待最终默认分支切换后验证。本次没有运行 V2 邮件工作流，也未解决已有调度延迟；迁移完成与实际定时覆盖分别记录。
- 脱敏部署报告和公开页面检查留在忽略的 temp/。仅本地补充执行证据，不为文档再推送触发一次无应用变动的测试部署。
