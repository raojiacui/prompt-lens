# ADR 0006：恢复主站生产域名自动分配

- 状态：已采纳
- 日期：2026-10-24

## 背景

线上项目 `prompt-lens`（`prj_LA38e0saqqVw1OkQ95AyoMx5vjIV`）曾执行 Instant Rollback，Vercel 因此关闭了生产域名自动分配。后续 `main` 分支提交虽然成功生成 Production 部署，但只停留在 Staged 状态，`prompt-lens.cc.cd` 继续指向旧部署。

2026-10-24 的 `c5ff7f9` 部署包含近期三项主站改动：移除旧 URL 解析依赖、修复 OAuth state 持久化，以及将视频剪辑入口标记为开发中。

## 决策

1. 明确提升 `c5ff7f9` 对应的 Production 部署 `7MpMboWcU28djtnAMbEUYEP2dWhU`，将其绑定到 `prompt-lens.cc.cd`。
2. 通过本次 Promote 解除当前 Instant Rollback，恢复生产域名自动分配，使后续 `main` 分支的成功 Production 部署自动上线。
3. 线上项目与 V2 测试项目继续隔离；`prompt-lens-v2-test`（`prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI`）不得绑定或发布到主站域名。

## 备选方案

### 保持 Staged 并每次手动 Promote

可以增加人工发布闸门，但当前团队期望 `main` 持续代表线上主站，人工步骤容易再次造成代码已推送但主站未更新，因此不采用。

### 重新构建并部署当前代码

会产生新的构建产物，无法直接复用已经验证为 Ready 的 `c5ff7f9` 部署，增加发布等待时间和不确定性，因此不采用。

### 继续保留回滚版本

会让近期修复和产品限制持续缺席主站，无法满足当前发布目标，因此不采用。

## 影响

- `prompt-lens.cc.cd` 使用 `c5ff7f9` 及其祖先提交的代码。
- 后续推送到 `main` 的成功 Production 部署会自动更新主站。
- 若未来需要人工发布闸门，应显式关闭自动分配并新增或更新 ADR，避免把 Staged 状态误判为已上线。
- V2 测试项目的部署和域名保持独立，不会因本决策自动进入主站。

## 验证计划

- 检查 Vercel 部署来源为 `main`、提交为 `c5ff7f9`、状态为 Current/Ready。
- 请求 `https://prompt-lens.cc.cd/dashboard`，确认其 Dashboard 静态文件包含 `dashboard.tabs.inDevelopment` 和禁用逻辑。
- 后续推送一项低风险 `main` 变更时，确认 Vercel 自动分配生产域名，无需再次手动 Promote。
