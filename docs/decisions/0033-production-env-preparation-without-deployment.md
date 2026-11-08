# ADR 0033：按正式环境语义补齐 V2 配置，保留原凭据且不部署

- 日期：2026-11-08
- 状态：配置补缺已执行并验证；正式上线及业务验收未执行。
- 关联：ADR 0027、0031、0032；上线过程记录第 003 项。

## 背景

负责人明确授权“把 v2 的环境变量和正式站对比一下，然后缺啥补啥”。本次比较两个 Vercel 项目的 Production 变量：正式项目 `prompt-lens` 原有 44 项，测试项目 `prompt-lens-v2-test` 有 45 项，测试侧有 13 项名称在正式侧缺失。变量名称差异需结合源码判断，不能整包覆盖正式配置。

本次授权涵盖正式环境变量补缺；沿用逐项准备的发布安排，不切换分支、不部署、不更新 Worker 或数据库。

## 决策

1. 仅向正式项目 `prj_LA38e0saqqVw1OkQ95AyoMx5vjIV` 增加缺失的 Production 变量。创建使用 `upsert=false`，不覆盖已有配置，不增加 Preview/Development 目标。
2. 操作前读取 `.vercel/project.json`，确认工作区仍绑定测试项目 `prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI` / `prompt-lens-v2-test`；通过明确项目 ID 操作获授权的正式配置，不重新绑定工作区。
3. 沿用已验证的解析服务账号，将其现有 EasyDown 凭据在内存中传递到正式项目，保存为 `sensitive`；不记录原值、不通过降级类型回读、不额外消耗解析次数。两个环境共用该第三方账号的服务额度。
4. 正式邮件链接使用正式域名；品牌图片沿用当前公开资产，分别 HEAD 验证可访问。保留正式 SMTP 凭据，以其认证邮箱自身作为 `Prompt Lens` 发件人；587 端口显式设置 `SMTP_SECURE=false`，对应 STARTTLS。
5. 计费和改写开关按 V2 的预期发布行为准备为 `true`。这是后续新部署的配置准备，不代表相关正式依赖已验收；不修改任何既有验收标记。
6. 不复制测试白名单，不添加未参与权限判断的 `ADMIN_EMAILS`，不引入会改变旧用户密钥解密路径的 `BYOK_ENCRYPTION_KEY`。正式数据库、认证、OAuth、R2、Worker、Cron 及支付宝既有变量均保留。

## 新增配置

| 变量 | 准备结果 |
| --- | --- |
| `EASYDOWN_API_KEY` | 沿用已测试的解析账号凭据，保存为 sensitive |
| `SMTP_FROM` | `Prompt Lens` 加正式 SMTP 认证邮箱自身地址；未复制本地另一组 SMTP 配置 |
| `SMTP_SECURE` | `false`，匹配正式端口 587 |
| `DATABASE_MAX_CONNECTIONS` | `5`，显式保留源码原默认值 |
| `EMAIL_PUBLIC_SITE_URL` | `https://prompt-lens.cc.cd` |
| `EMAIL_ASSET_BASE_URL` | 沿用当前公开品牌图片地址，两张图片 HEAD 均为 200 |
| `COMMERCIAL_REVIEW_ALERT_EMAIL` | 原测试配置中的负责人邮箱，核对为 `raojiacui@gmail.com` |
| `COMMERCIAL_CONSUMPTION_ENABLED` | `true`，准备 V2 计费行为 |
| `COMMERCIAL_REWRITE_ENABLED` | `true`，准备 V2 套餐改写行为 |
| `WELCOME_EMAIL_ENABLED` | `false`，保持测试设置及正式源码缺省行为 |

## 备选方案

- 整包复制测试变量：会覆盖正式资源及凭据，并将测试访问限制带入公开站点，不采用。
- 新建 BYOK 加密密钥：当前正式源码回退使用 `BETTER_AUTH_SECRET`，直接切换会破坏旧密文读取；后续若迁移需独立设计，不在本次补缺中执行。
- 复制本地 SMTP 全套配置以绕过正式 SMTP 故障：只读比较发现两组配置不同，不替换既有生产服务。先记录故障，由后续邮件配置步骤处理。
- 补变量后立即重新部署：当前处于发布准备，保留旧部署，正式切换留在最终发布窗口。

## 后果与验证

- 正式 Production 变量从 44 项变为 54 项。原有 44 项的 ID、类型、目标、更新时间和分支元数据逐项一致；测试 45 项的相应元数据全部一致。
- 9 项非敏感新增配置逐项回读并与写入值匹配。EasyDown 凭据的创建结果成功，回读列表确认名称、Production 目标及 sensitive 类型，不请求其保存后的明文。
- 测试邀请白名单在内存中核实仍恰为 `raojiacui@gmail.com`、`raojinbo@gmail.com`，未复制到正式项目。
- 正式 SMTP 只执行连接及登录验证，没有发邮件；现有凭据返回 `EAUTH / AUTH PLAIN`。新增发件人无法解决已有认证失败，后续需核正 Gmail 应用专用密码，再验证 SMTP、验证码送达和登录。
- 2026-11-07 核查发现的正式支付宝公钥验签问题仍待支付宝控制台核正；本项没有修改支付变量，也没有重新执行支付验收。
- 正式域名操作前后均指向 `dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV`。没有调用部署、重新部署、提升、回退或分支切换接口；新增变量供后续部署采用，当前旧部署保持不变。
- 保留 `COMMERCIAL_SCHEDULER_ACCEPTED` 等既有验收标记。变量存在不代表服务凭据有效、Worker 配套或业务验收通过；正式链接导入、付费分析、改写、支付及邮件仍按上线清单收集实际证据。
- 只提交本 ADR 和上线记录，不为配置准备额外推送 V2 分支触发测试部署；临时只读核查脚本置于被忽略的 `temp/`，不提交密钥或环境导出文件。
