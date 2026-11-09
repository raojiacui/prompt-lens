# Vercel 生产日志邮件巡检

GitHub Actions 工作流 `.github/workflows/vercel-log-email-monitor.yml` 配置为每小时第 7、37 分钟检查正式项目 `prompt-lens` 的生产日志，每次回看执行时点之前 30 分钟。GitHub 调度可能延迟，实际执行间隔需要从运行记录核对。

巡检范围：

- Vercel 项目：`prompt-lens`（`prj_LA38e0saqqVw1OkQ95AyoMx5vjIV`）
- 环境：`production`
- 监控范围按正式项目的 `production` 环境选择，不硬编码 `main` 或 V2 分支；正式部署来源切换后继续检查同一正式项目。
- 错误级别：`error`、`fatal`
- HTTP 状态：`5xx`

没有可操作错误时，工作流保持静默。发现错误或 Vercel 查询失败时，工作流通过 SMTP 发送中文摘要。工作流没有代码写入、提交、推送或部署权限。

## V2 迁移与启用顺序

- 本次从旧正式提交 `75eb611f8759745ec743818bce24350691d6ab8d` 迁入工作流、报告脚本及已有测试，工作流 Node 改为 24，Vercel CLI、nodemailer 版本及 Actions 提交固定值保留。
- 目前仓库默认分支仍为 `main`，已有定时巡检继续从 main 运行。把工作流推送到 V2 不会额外启动第二套定时巡检，也不会切换正式站。
- GitHub 定时工作流从默认分支执行。最终发布时将默认分支改为 `prompt-lens-V2` 后，工作流及报告脚本继续从 V2 取得。仓库级 Actions Secrets 沿用原名称及值，不把 Vercel 项目变量自动当作 GitHub Secrets，也不复制测试站凭据。
- 切换后检查 schedule 运行的 head_branch、head_sha、采集结果及邮件处理步骤，确认来自目标 V2 提交；未收集这些证据前，不能声明切换后的云端链路已验收。
- 不增加 push 触发、部署命令、写仓库权限或 Fly 健康探测。此巡检覆盖 Vercel 错误日志与 5xx，不覆盖 Fly 日志或“整个调度没有产生新日志”的失联情况。

## GitHub Actions Secrets

在仓库的 `Settings → Secrets and variables → Actions` 中配置：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `VERCEL_TOKEN` | 是 | 具备 `raojiacuis-projects` 团队和 `prompt-lens` 项目日志读取权限的 Vercel Token |
| `SMTP_HOST` | 是 | 邮件服务 SMTP 主机 |
| `SMTP_PORT` | 是 | SMTP 端口，常见值为 `465` 或 `587` |
| `SMTP_SECURE` | 是 | 端口 465 通常填 `true`，端口 587 通常填 `false` |
| `SMTP_USER` | 是 | 发件邮箱账号 |
| `SMTP_PASS` | 是 | 邮箱 SMTP 授权码或应用密码，避免使用网页登录密码 |
| `ALERT_EMAIL_TO` | 是 | 收件邮箱；多个地址可用英文逗号分隔 |
| `ALERT_EMAIL_FROM` | 否 | 发件人地址，省略时使用 `SMTP_USER` |

Vercel Token 和邮箱授权码只存入 GitHub Secrets。不要写入仓库文件、Actions 变量或日志。

## 验证

1. 核对已有 Secrets 名称齐全；更新值需通过负责人可信来源配置，不在聊天或日志公开凭据。
2. 打开仓库的 `Actions → Monitor Vercel production errors`。
3. 需要实际邮件通道验收且已明确授权发信时，选择正确分支运行，勾选 `Send an email even when the selected log window is clean`。
4. 确认工作流成功，并收到标题包含“邮件通道测试”的邮件。
5. 后续普通手动运行和计划运行不勾选测试邮件；无错误时不会发送邮件。

## 已知覆盖边界

- 当前采用滚动 30 分钟窗口，适配此前实际遇到的 Vercel Hobby 日志 API 保留期。若两次运行间隔超过 30 分钟，会存在无法由该查询补回的缺口；不能简单扩大到 1 小时或 24 小时并宣称兼容。
- 2026-11-09 核查的最近四次计划运行都成功，但间隔数小时；本次代码迁移不证明调度延迟已经解决，原因及更稳定的调度方案继续核查。
- 工作流 success 可能是无错误时静默完成，也可能发送了摘要；应结合具体步骤输出及收件箱判断，不能据 success 推定邮件送达。
- 邮件服务失败会使工作流失败；不能依靠同一故障 SMTP 通道发送其自身故障提醒。
- 2026-11-09 完整只读核查：78 次 schedule 均成功，耗时中位 26 秒，但相邻运行创建间隔中位约五小时。缺口出现在运行创建一侧，具体内部原因未确认；外部触发及重叠窗口去重方案见 [ADR 0050](../decisions/0050-log-monitor-schedule-gap-investigation.md)，尚未实施。
- 官方规则：[GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
