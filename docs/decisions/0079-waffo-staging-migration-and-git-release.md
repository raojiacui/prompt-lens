# ADR 0079：Waffo 测试库迁移与 Git 测试发布

- 日期：2026-11-20
- 状态：测试库迁移完成，测试 Git 发布准备中，实际交易未验收。

## 背景

负责人创建三档测试商品，补齐三个产品 ID 以及 WAFFO_PAYMENT_ENVIRONMENT、WAFFO_STORE_ID、WAFFO_PAYMENTS_ENABLED=false，并确认继续处理测试库与代码发布。Vercel 元数据确认这些变量在唯一测试项目的 Production 范围存在；敏感变量不能回读，具体内容须通过实际应用校验。

## 决策

- 仅迁移 Supabase prompt-lens-v2-test（mwczjgflbmzgvebfilnf）。已查询确认 payment_orders 存在且 id 为 uuid，0026 审核迁移已应用，Waffo 事件表和 provider 尚未添加。执行已本地空库验证的 0027，不改写历史订单、钱包或用户权益。
- 事件表只供服务端使用：RLS 开启、PUBLIC/anon/authenticated 无权限，保留环境、门店、事件去重及订单外键。
- 实际 Vercel 部署与构建脚本一致：测试项目 prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI 从 staging/v2 发布；正式项目 prj_LA38e0saqqVw1OkQ95AyoMx5vjIV 从 prompt-lens-V2 发布。仓库 AGENTS 中仍有 V2 切换前的分支说明；沿用负责人此前指定并实际运行的 staging/v2 测试链路，禁止向会触发主站的 prompt-lens-V2 推送。
- 本地代码已验证并提交，经 Git 推送测试分支触发自动部署；不使用 CLI 上传或手动提升。核对远端 SHA、source=git 的部署 SHA、固定测试域名和主站部署 ID。
- 开关暂时保持 false。此阶段只验证迁移与发布可达性；负责人随后在测试项目开启沙箱支付，再验证真实网关汇率、商品、银行卡、通知、到账及退款。不得提前写验收通过标记。

## 备选方案

- 按过期说明推送 prompt-lens-V2：当前会触发主站，超出本次测试范围，不采用。
- 直接手动发布：绕过 Git 来源校验，不采用。
- 在正式库提前加支付结构或开放收款：无本次授权，不采用。

## 后果与验证

新增迁移不影响既有商业消费和邀请限制。发布前主站 prompt-lens.cc.cd 为 dpl_5pvcy1GTM9Txr7DoC9aGd6HcRiBF，Git SHA 6af28cce4dcc1fb5c88ccab3567f415898d4e88e，须确认发布后不变。付款开关关闭不代表支付验收通过。迁移及部署结果在完成后追加。

### 测试库结果

Supabase 迁移 20261120064917 / waffo_payment_provider_and_events 已成功应用于 mwczjgflbmzgvebfilnf。复查事件表及 waffo provider 存在，RLS=true，anon/authenticated 的 SELECT/INSERT/UPDATE/DELETE 权限均为 false；主键、事件唯一索引和订单索引共三项存在，事件初始行数为 0。未修改正式库，未创建模拟付款或发放权益。
