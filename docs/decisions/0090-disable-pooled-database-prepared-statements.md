# ADR 0090：关闭数据库客户端命名预编译语句

- 日期：2026-11-28
- 状态：本地修复已验证，负责人已授权发布主站；正式部署与任务恢复验收待完成。

## 背景

正式视频分析任务 `28573a05-b726-4636-b5d5-b1bc479e068b` 于北京时间 13:47:27 启动，13:53:29 自动恢复后再次启动。两次均未创建任何 `analysis_scene_jobs`，没有进入镜头素材处理或模型调用阶段，父任务保持 running。

正式 Supabase 日志分别在 05:47:27.378 UTC 和 05:53:29.871 UTC 记录 `prepared statement … does not exist`、SQLSTATE `26000`，两条记录的 query_id 相同。同期存在大量相同类型错误。数据库客户端 postgres.js 未配置 `prepare: false`，默认命名预编译语句与 Supavisor 事务连接池的连接复用约束不兼容。两次错误均紧随启动发生，构成此次初始化失败的关键证据；现有应用日志未记录执行权退出原因，仍需发布后验证完整因果链和恢复结果。

## 决策

在共享应用数据库客户端显式设置 `prepare: false`，遵循 Supabase 对 postgres.js 的连接要求。继续使用现有连接地址、TLS 校验、连接上限及事务边界，不修改业务任务、余额或模型请求。

参考：https://supabase.com/docs/guides/database/postgres-js

## 备选方案

- 继续依赖驱动在预编译语句失效后自动重试：事务内首次错误会使事务失效，无法作为可靠恢复策略。
- 改用直连或 session pooler：涉及连接额度、网络与运行配置变更，本次不扩大基础设施范围。
- 设置 `max_pipeline: 0`：官方文档说明它会破坏 postgres.js 的 begin 事务，不采用。

## 后果

每次查询使用未命名语句，放弃跨请求命名语句缓存以兼容连接池。参数绑定和事务原子性保留。此修复也作用于其他使用共享客户端的数据库操作；不能用本地内存数据库测试通过替代真实连接池验收。

## 验证计划

- 本地已执行 `vitest run tests/database-tls.test.ts tests/commercial-wallet.test.ts -t 'database TLS|prepares the next scene|runs paid analysis from server probe' --maxWorkers 1`：12 项通过，149 项未选中。使用 PGlite 和模拟外部服务，不触达正式业务或收费模型。
- 隔离正式发布工作区再次运行上述 12 项测试及完整 `npm run build`，均通过；本地构建仅有既有 lint、Edge Runtime、Browserslist 和开发 OAuth 配置警告，未调整功能或凭据门控。
- 运行已有视频分镜流水线和数据库 TLS 回归测试，确认初始化、素材准备、模型模拟、结果保存和证书校验保持通过。
- 负责人在本次会话明确授权“推送主站”，从正式分支最新提交建立隔离发布工作区，仅移入数据库连接修复和本 ADR；通过 `prompt-lens-V2` 分支的 Git 集成发布正式项目，不包含当前工作区正在进行的图片计费改动。
- 发布后检查正式部署 SHA，观察正常恢复或用户已确认任务是否创建 3 个子任务并推进到素材准备、Kie 请求和结算；核对新增时间窗口中不再出现同类 `26000` 错误。
- 验收前保持本 ADR 为待完成状态，不把 HTTP 200 或唤醒成功视为任务恢复成功。
