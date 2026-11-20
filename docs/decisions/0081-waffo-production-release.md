# ADR 0081：Waffo 正式支付发布

- 日期：2026-11-20
- 状态：负责人授权生产发布；正式配置与沙箱成功到账证据待补齐。

## 背景

负责人确认测试环境通过并要求上生产。实际测试项目已验证五种外币报价和结账创建；本轮查询独立测试库发现三个 Waffo 订单仍为 pending、事件表 0 行，尚无本站成功发放证据。正式项目只有原审核凭据，支付环境、门店、三个商品 ID 和开关尚缺。

## 决策

- 按本次明确授权准备正式发布，目标 Vercel `prompt-lens`（`prj_LA38e0saqqVw1OkQ95AyoMx5vjIV`）、正式域名 `prompt-lens.cc.cd`、Supabase `vxlwqiohliynbtjwivte`。
- 以实际 Git 集成与既有构建守卫为准，正式分支为 `prompt-lens-V2`，测试分支仍为 `staging/v2`。发布前核对绑定和完整远端 SHA，不通过 CLI 上传或手动提升。
- 正式库应用已在测试库验证的 0027，新增 provider 和私有事件去重表，开启 RLS，撤销 PUBLIC/anon/authenticated 权限，不修改历史订单或余额。
- 正式开关先为 false。补齐正式商品、正式凭据和生产 Raw Webhook 后，仍须验证成功付款→签名通知→唯一发放到账；在实际证据到位前不宣告验收通过或开启公众真实收款。
- 正式支付与测试支付的项目、环境、商品和通知必须相互隔离；敏感变量由负责人在 Vercel 配置，不从聊天收集私钥。

## 备选方案

- 直接按“结账页面已打开”视为到账验收：现有数据只有 pending，不能采用。
- 将测试 Key/商品复制为正式配置：环境权限不同，不能采用。
- 同时改动部署保护、邀请白名单或历史权益：与支付发布无关，不采用。

## 后果与验证

迁移为兼容性新增，可提前准备；关闭状态下没有 Waffo 真实收款入口。上线核对正式远端 SHA、Git 来源部署 SHA、正式域名部署 ID、回调响应、生产报价和配置；记录实际付款/通知/到账和退款结果，未验证项保留待办。

### 正式库准备结果

45 项支付、币种、配置及全新库迁移回归通过。正式库预检确认原 provider 不含 waffo、事件表不存在、订单主键为 UUID。已应用 `20261120075141 / waffo_payment_provider_and_events`，对应已验证的 0027；复查 RLS=true、三个索引、事件 0 行，anon/authenticated 无 SELECT/INSERT 权限。未修改任何历史订单、钱包或权益。

安全 advisor 的事件表“RLS 开启无策略”为仅服务器访问的预期设计；其余既有表同类 INFO 共 41 项。另有既有 `pg_net` 扩展位于 public 的 WARN，本次未改动该扩展，参考 https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public 。没有新增开放读取策略。
