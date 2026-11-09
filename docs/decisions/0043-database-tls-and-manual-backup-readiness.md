# ADR 0043：核实数据库加密缺口，采用免费手动业务备份与本地恢复验证

- 日期：2026-11-09
- 状态：只读核查、手动业务备份和本地恢复验证完成；按负责人要求在该节点停止。V2 客户端 TLS 修正尚未实施。
- 关联：ADR 0032、0034；上线记录第 012 项。

## 背景

上线准备需确认连接加密、数据备份及恢复能力，源码 Release 无法恢复数据库。正式库存在用户、分析历史、项目、订单及积分权益记录，不能当作空库处理。负责人明确选择手动备份，并要求尽快完成以便上课；本轮不扩展为购买套餐、生产恢复或数据库重启。

## 已核查事实

- 正式 Supabase 项目 vxlwqiohliynbtjwivte 健康，38 张 public 业务表；另有 drizzle 与 supabase_migrations 迁移记录。
- 正式 DATABASE_URL 未带 sslmode，当前 postgres.js 默认解析 ssl=false；测试为 sslmode=require，启用加密但驱动不核验证书。服务端支持 SSL 不等于应用连接已加密。
- 最初使用系统根证书严格校验时，两连接池均报 SELF_SIGNED_CERT_IN_CHAIN。未发送明文认证，没有通过关闭校验来完成诊断。
- 从已登录的正式项目 Database Settings 获取官方公开 CA 下载链接，下载并确认 CA 属性、有效期及 SHA-256。加入该 CA 后，两连接池均通过证书/主机名校验和 TLS 1.3 握手，严格加密连接的只读事务 SELECT 1 成功，transaction_read_only=on。
- 控制台 SSL enforcement 关闭。本轮未切换开关；官方说明更改会触发数据库重启，不能在旧客户端尚未启用 TLS 时直接强制。
- 正式项目控制台明确为 Free，不包含 Scheduled backups；PITR 页面提示 Pro 付费附加项。未购买、升级或创建付费项目。

## 决策

- 负责人选择手动备份、保持 Free。采用 PostgreSQL 官方 Windows 下载页指向的 EDB 17.11 便携工具，解压至忽略的 temp/，不安装 Windows 系统服务。
- 通过 verify-full 和官方 CA 从正式库导出 public、drizzle、supabase_migrations，覆盖业务数据与迁移记录。使用只读、可重复读事务导出的同一快照获取表内容校验值并传给 pg_dump，避免以不断变化的在线数据作恢复比较。
- 备份保存到被 Git 忽略的 .data/backups/ 私有目录，ACL 限当前用户、SYSTEM 和管理员。数据库密码只通过进程内存/子进程环境传递，不写入命令参数或仓库。
- 在全新本机独立 PostgreSQL 实例恢复；仅绑定 127.0.0.1，使用临时口令。恢复命令前明确检查目的地为本机，绝不连接正式或测试云库。完成后停止本地实例。
- 校验每张备份表的行数和行内容聚合指纹，保存备份文件 SHA-256。恢复成功仅证明所选业务快照可恢复，不冒充整个 Supabase 托管平台的灾难恢复演练。
- 本轮先完成负责人明确授权的备份；V2 客户端使用官方 CA 强制加密/证书校验的改动列为下一步，当前仍是上线前待处理项，不提前标记通过。

## 范围与恢复边界

- 这是业务 schema 与迁移记录的逻辑快照，不含托管 auth/storage/realtime/net/vault 平台内部状态、角色密码、R2 文件、外部密钥与部署配置。应用使用 Better Auth 的 public 用户/账号表，属于本次业务备份。
- 导出使用 no-owner/no-privileges，便于本地恢复；真实目标恢复须独立核对角色、权限、RLS、扩展及环境配置，再开放流量。
- 备份文件含账号及业务信息，私有访问控制不等于文件已加密或已有异地副本。本轮不上传公开桶、GitHub Release 或其他外部服务。
- 当前快照用于准备与验证，最终上线窗口前应重新取得新快照。回退 Web 部署不自动回滚数据；不能用旧快照直接覆盖上线后新增订单、余额、账本或用户记录。
- 未规划自动周期备份或承诺恢复时间；持续备份及异地受保护副本另行确认。

## 替代方案

- 只保存源码 Release：不包含数据库数据，不足以覆盖本项。
- 升级 Pro/PITR：需付费及用户另行决定，本轮负责人选择不升级。
- 直接在正式库点击恢复以验证：会替换数据并造成停机，不执行。
- 禁用证书校验或直接打开服务端 SSL enforcement：前者没有解决身份校验，后者会重启并可能中断旧客户端，均不采用。

## 验证证据

- 官方 CA 文件 SHA-256：700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7，有效期至 2031-04-26。
- 两库严格 TLS 1.3 及只读事务已验证；无明文认证、DDL、业务写入或全局 SSL 配置改变。
- 已生成私有备份 .data/backups/2026-11-09-manual-1794210490335/prompt-lens-business.dump，3,838,260 字节；SHA-256 为 0be92d6fd74a34f3ddcea2f43cbee6fc48dbac568b1f1132bca93253810377e6。
- 一致快照涵盖 40 张表：public 业务表及两套迁移记录；在全新本地 PostgreSQL 17.11 恢复成功，逐表行数和行内容聚合指纹全部匹配，归档目录、日志和完整清单保存在同一私有目录。
- 本地验证进程已停止，localServerStopped=true；未向正式库或测试云库恢复、写入、执行迁移或重启，未改环境变量、部署、付费套餐或全局 SSL 开关。
- 负责人要求在下一个小节点停止，本次到已验证备份为止。仅保存文档本地提交，不推送、不触发额外部署；下一次继续 V2 客户端 TLS 修正与其他上线前事项。

## 官方依据

- [Supabase 备份](https://supabase.com/docs/guides/platform/backups)：Free 手动导出、备份不含对象存储内容及恢复边界。
- [Supabase SSL](https://supabase.com/docs/guides/platform/ssl-enforcement)：官方 CA、严格校验及服务端开关的重启影响。
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)：一致快照、自定义归档及恢复验证。
- [官方 Windows 工具入口](https://www.postgresql.org/download/windows/)指向 EDB 便携包；本次版本 17.11。
