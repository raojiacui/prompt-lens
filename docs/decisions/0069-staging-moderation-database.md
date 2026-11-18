# ADR 0069：测试站内容审核数据库与服务端访问边界

- 日期：2026-11-18
- 状态：独立测试库迁移及结构验证完成；应用端到端验收待完成。
- 关联：ADR 0006、0034；`docs/staging-aigc-moderation-controls.md`。

## 背景

负责人已配置 Google Cloud，要求检查剩余数据库步骤。当前分支为 `staging/v2`，已有迁移 `0026_moderation_controls`，但独立测试库尚无动态词库及审核记录表。迁移缺少 RLS 与角色权限限制，直接执行可能暴露服务端审核资料。

## 决策

- 仅向 Supabase `prompt-lens-v2-test`（`mwczjgflbmzgvebfilnf`）应用审核迁移，正式库 `vxlwqiohliynbtjwivte` 不变更。通过项目列表、历史 ADR、本地连接用户名及实际数据库目录交叉核对目标。
- 保留仓库原有 Drizzle 迁移结构，在尚未应用的 0026 中补充两表 RLS，撤销 PUBLIC、anon、authenticated 的全部表权限。无需浏览器直连策略，继续由服务端数据库连接和管理员接口负责授权。
- 使用 Supabase 托管迁移 `staging_moderation_controls` 执行完整 0026 SQL；不运行全量 Drizzle 迁移，不校准此前历史账本。Drizzle journal 已登记 0026；Supabase 与 Drizzle 的历史仍独立，后续全量迁移前须核对实际结构。
- 仅新增两表、索引及原迁移中 11 条基线规则。词库需要持续维护，初始规则不代表完整合规覆盖。不修改既有业务表、套餐、邀请控制或验收标记。

## 备选方案

- 原样执行迁移：缺少数据库访问边界，不采用。
- 全量 schema push 或重跑历史迁移：可能改动无关结构且已有历史差异，不采用。
- 为浏览器角色添加宽松 RLS 策略：与当前服务端专用架构不符，不采用。

## 影响

测试站可保存动态规则及审核决策；匿名和普通 Supabase 登录角色不能直接访问两表。服务端特权角色仍可写入，应用接口的管理员授权与审计逻辑继续承担职责。该权限设置不限制数据库管理员修改审计记录。

## 验证计划与结果

- 本地 PGlite 空库执行完整 SQL 两次通过，验证幂等、11 条规则、空审核记录、两表 RLS 和匿名 SELECT 被拒。
- 审核相关 Vitest 三个文件共 27 项通过；沙箱首次因 esbuild 子进程 EPERM 无法启动，获执行权限后重跑成功。差异空白检查通过。
- 托管测试库迁移成功。public 表从 38 增至 40；词库 11 字段、3 个有效索引，记录表 16 字段、5 个有效索引；两表 RLS 开启、无浏览器策略，anon/authenticated 均无所查表权限。11 条规则全部启用，无非法 action；审核记录数为 0，未伪造真实审核结果。
- 安全 advisor 仅返回 `rls_enabled_no_policy` INFO，覆盖全部 40 张服务端专用表，符合当前访问设计；未返回 WARN/ERROR。说明：https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy 。
- Vercel 配置实读确认 Google 两项变量存在于测试项目 Production；未读取其敏感值。数据库变量接口仍返回加密值，未据此声称验证了当前部署实际数据库连接。未触发部署或真实模型调用，未改正式库。
- 本次仅修改 SQL 和决策记录并本地提交。Google 异步响应省略 `done` 的处理问题仍待修复；管理员后台读写、当前部署连接、真实视频提交/轮询/放行及审核记录入库须另行完成端到端验证。
