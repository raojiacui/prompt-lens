# ADR 0003：隔离 V2 测试部署与正式站部署

- 状态：已接受
- 日期：2026-10-22
- 决策方：Prompt Lens 项目团队

## 背景

Prompt Lens V2 在替换现有正式版本前，需要一个稳定的线上测试环境。2026 年 10 月 22 日，仓库的 `prompt-lens-V2` 分支被部署到了现有的 Vercel 正式项目 `prompt-lens`，并成为 Production 部署，导致 `prompt-lens.cc.cd` 暂时展示尚未发布的 V2 界面。

Vercel 元数据确认，这次误上线由 CLI 发起，记录为 `source: cli`、`actor: codex`、`target: production` 和 `githubCommitRef: prompt-lens-V2`。V2 工作区中被 Git 忽略的 `.vercel/project.json` 仍指向正式项目 ID，CLI 的生产部署命令因此沿用了错误的项目绑定。这次事件与 Preview 部署自动提升无关。

正式项目随后回滚到 2026 年 10 月 19 日创建的部署 `dpl_HvZt8Wy8rLr4T4PmqGDuZq9QPTk5`。Vercel 已确认 `prompt-lens.cc.cd`、项目生产地址和 `main` 分支地址均指向恢复后的部署。

## 决策

- 现有 Vercel 项目 `prompt-lens` 继续作为 `prompt-lens.cc.cd` 的正式生产项目。
- V2 的全部线上测试使用独立 Vercel 项目 `prompt-lens-v2-test`，测试地址为 `https://prompt-lens-v2-test.vercel.app`。
- V2 可以在 `prompt-lens-v2-test` 项目内部使用 Production 目标，因为 Vercel 的 Production 标记以项目为边界。
- 每次执行 Vercel 变更前，必须明确核对项目名称和项目 ID，禁止依赖未经检查的本地项目绑定。
- V2 工作区的 `.vercel/project.json` 必须指向测试项目 `prompt-lens-v2-test`，项目 ID 为 `prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI`。
- 正式项目 `prompt-lens` 的项目 ID 为 `prj_LA38e0saqqVw1OkQ95AyoMx5vjIV`。V2 测试期间禁止向该项目部署。
- 只有项目负责人明确决定正式发布 V2 后，`prompt-lens` 项目才可以接收 V2 部署。

## 备选方案

### 在正式项目中使用分支 Preview 部署

Preview 部署适合短期评审，但它与正式域名共用同一个项目。项目绑定错误或人工提升操作仍可能影响正式站，因此不适合作为 V2 长期测试的唯一隔离措施。

### V2 发布前只在本地测试

本地环境无法完整验证云端回调、环境变量、后台 Worker、用户认证和生产网络行为，覆盖范围不足。

### 在正式项目中绑定临时测试域名

临时域名仍与正式站共用生产项目，部署或域名别名操作影响正式站的风险依然存在。

## 影响

- 正式站与 V2 测试站拥有独立的部署历史和固定访问地址。
- V2 的环境变量和访问控制需要单独维护在测试项目中。
- `prompt-lens-v2-test` 中标记为 Production 的部署仍属于测试环境，因为该标记只在测试项目内部生效。
- V2 正式发布时，需要获得项目负责人明确授权，并主动部署到 `prompt-lens` 项目。
- 当前 V2 工作区已改绑到测试项目，降低 CLI 命令误操作正式项目的风险。

## 验证计划

- 每次部署相关操作后检查 `https://prompt-lens.cc.cd`，确认其部署 ID 仍属于预期的正式版本。
- 检查 `https://prompt-lens-v2-test.vercel.app`，确认它由 `prompt-lens-v2-test` 项目提供服务。
- 每次执行 Vercel 变更前读取 `.vercel/project.json`，只有项目名称和 ID 与测试项目完全一致时才继续。
- 确认 V2 测试部署没有在 `prompt-lens` 项目中新增或修改域名别名。
- 未来正式发布 V2 前，先记录当时的正式部署 ID，确保可以快速回滚。
