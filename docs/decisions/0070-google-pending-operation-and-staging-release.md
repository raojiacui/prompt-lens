# ADR 0070：兼容 Google 异步审核等待响应并通过 Git 发布测试站

- 日期：2026-11-18
- 状态：本地验证完成，测试站发布核验中。
- 关联：ADR 0069；`docs/staging-video-output-moderation.md`。

## 背景

Google Video Intelligence REST 在操作未完成时通常省略默认 false 的 `done` 字段，仅返回操作名称与可选进度。现有代码只接受显式 `done: false`，导致正常提交被判为异常，无法保存轮询入口。负责人明确授权修复并推送测试站，真实视频联调随后进行。

参考：https://docs.cloud.google.com/video-intelligence/docs/analyze-safesearch 。

## 决策

- 合法操作名称配合省略 `done` 或显式 false 均进入 checking，保留操作名称供后续轮询；只有显式 true 且帧审核结果满足原规则才允许放行。
- 非布尔 done、缺少或无效操作名称、带终态结果却未标记完成的响应保持 unavailable。Google 错误响应优先处理，保持失败关闭。
- 沿用原有检测范围、30 分钟超时、审计、邀请控制与权益检查，不扩大检测能力声明。
- 按负责人最新指定分支 `staging/v2` 经 Git 集成发布到唯一测试项目 `prompt-lens-v2-test`，不向旧发布分支推送、不 CLI 上传、不手动提升。现有构建过滤脚本只允许该测试项目构建 staging/v2；正式项目仅允许 prompt-lens-V2。

## 备选方案

- 所有缺少 done 的响应一律视为等待：可能接受无操作编号或损坏数据，不采用。
- 每次重交审核任务：增加费用并丢失原任务关联，不采用。
- 修改正式项目或合并到正式分支：超出本次测试站授权，不采用。

## 影响

正常异步响应可持续轮询，未审核视频仍被暂缓展示。本次连同已提交的审核数据库权限修复和记录发布；不再次运行数据库迁移。

## 验证计划与结果

- 三个审核测试文件共 30 项通过，包括省略 done、无效状态、错误响应和对同一操作先等待后完成的轮询回归。
- TypeScript 全量检查通过；修改产品源码 ESLint 与差异检查通过。测试目录按仓库 ESLint 配置忽略，由 Vitest 和类型检查验证。
- 发布前核对本地 Vercel 绑定为测试项目。正式域名 `prompt-lens.cc.cd` 发布前指向 `dpl_BdMEywStff5ekZmV5Ff2kc2Yv87t`；测试固定域名为 `prompt-lens-v2-test.vercel.app`。
- Node 24.13.0 本地生产构建通过，使用不可用的隔离数据库地址避免访问实际业务数据；现有 ESLint、工作区锁文件、Browserslist 与本地 GitHub OAuth 凭据缺失警告仍存在，未关闭登录提供商或产品功能。
- Git 推送和测试站 READY 状态、远端 SHA/部署 SHA/来源、固定域名与正式部署 ID 的发布后证据待补。
- 不把部署就绪视作真实审核通过；管理员后台操作及 Google 实际视频提交、轮询、放行和日志入库仍待负责人后续测试。
