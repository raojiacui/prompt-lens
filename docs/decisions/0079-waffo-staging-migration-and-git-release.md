# ADR 0079：Waffo 测试库迁移与 Git 测试发布

- 日期：2026-11-20
- 状态：测试库迁移和 Git 测试发布完成；应用冒烟检查完成，实际交易未验收。

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

### 发布前核对

已获取远端：staging/v2 为 4c18e50689e109ee118654216a6b416eb73846a7，正式 prompt-lens-V2 为 6af28cce4dcc1fb5c88ccab3567f415898d4e88e。正式分支的最新更新已合入本地 codex/waffo-payments，应用源码及依赖与已生产构建验证的 0777dde 完全相同。

重新运行支付、币种、配置及空库迁移共 39 项测试通过。实际构建守卫矩阵通过：测试项目 staging/v2/production 返回 1（允许）；正式项目 staging/v2/production 返回 0（跳过）；测试项目 prompt-lens-V2/production 返回 0（跳过）。没有为通过测试更改既有守卫。

无凭据 HTTP POST 空回调探测遇到网络连接超时，外部读取也不可达，不记为回调可达性通过。发布后仍须验证真实 Waffo 投递，且需要确认部署保护未拦截服务器通知。未修改部署保护、邀请白名单或验收标记。

### Git 发布及域名核对

- 本地提交 a0c6b72c0264c0368c4f315f5439d992b49df393 已仅推送 GitHub staging/v2，远端实读 SHA 一致；未推送正式分支。
- 测试部署 dpl_41jPVJfPV5XCZ8twVEUeQngWkwka 为 READY、source=git、target=production，项目为 prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI；Git 分支及 SHA 与远端一致。固定域名 prompt-lens-v2-test.vercel.app 已指向此部署。
- 发布后主站 prompt-lens.cc.cd 仍为 dpl_5pvcy1GTM9Txr7DoC9aGd6HcRiBF，Git SHA 仍为 6af28cce4dcc1fb5c88ccab3567f415898d4e88e，与发布前完全相同。
- 没有 CLI 上传、手动提升、环境变量或部署保护变更。

### 在线冒烟检查

改用 Windows 系统网络路径后，无登录请求成功到达测试站：/pricing 返回 200 且有多币种计费说明；POST /api/payments/waffo/webhook 空 JSON 返回 503 / WAFFO_NOT_ACTIVE；GET /api/payments/waffo/checkout 返回 401 / Authorized test account required。早先网络超时不再代表路由不可达，实际已确认回调可到应用且购买端保留邀请鉴权。

回调响应与负责人配置的关闭状态一致，但不代表门店、Key 和商品内容已经完成真实网关校验。下一步由负责人将测试项目 Production 的 WAFFO_PAYMENTS_ENABLED 改为 true 并重新部署，随后校验沙箱模式、真实汇率、各套餐及银行卡/钱包付款、签名通知、唯一到账和原币种退款。本轮没有触发支付、创建模拟订单或标记商业验收完成。此回执仅本地提交，线上业务代码继续以已核对的 a0c6b72 为准。

### 负责人启用沙箱开关后的核对

负责人随后确认完成开关修改与重新部署。测试部署 dpl_6Tsnt5tZ31wkFFLZxL1qk92Xr9bn 已 READY，沿用 a0c6b72 业务代码；这是负责人为环境变量生效而发起的 redeploy，未使用 CLI 或提升其他部署。

无凭据空 JSON 回调从 503/WAFFO_NOT_ACTIVE 变为 401/Invalid webhook，确认配置门禁已放行并进入验签入口，未签名请求被拒绝。不能据此宣告真实 RSA 通知、门店 Key、商品或汇率校验通过；下一步需在邀请账户登录会话中查看价格、打开 Waffo 测试结账页并使用沙箱付款工具完成交易。
