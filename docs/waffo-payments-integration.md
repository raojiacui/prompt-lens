# Waffo 一次性套餐支付接入

状态：代码和本地验证已完成，线上迁移、环境配置、Waffo 沙箱交易及正式收款尚未验收。支付默认关闭。本次没有修改线上环境、迁移线上数据库或发起真实交易。

## 已实现

- 官方 `@waffo/pancake-ts@0.28.0` 创建认证结账；下单前持久化用户、套餐价格和权益快照。相同用户和 requestId 重试同一订单，24 小时后停止重建结账。
- `GET/POST /api/payments/waffo/checkout`：公布已配置套餐；登录和同源校验；只使用服务端价格；支持按本人 orderId 重新取得结账链接。客户短期 token 不写入数据库。
- `POST /api/payments/waffo/webhook`：官方 RSA 验签与时间窗校验，核对门店、环境、订单归属、商品元数据、币种、税前价和实际付款；事务去重并发放积分、改写及链接导入权益。
- 定价页和账户订单页进入 Waffo 结账。回跳页轮询本站订单，浏览器不能自行宣告到账。原支付宝历史订单及退款保持独立。
- 多币种支持 CNY、USD、JPY、HKD、EUR、GBP。外币以 CNY 基价通过 Waffo 汇率换算，订单持久化后锁价；外币结账请求银行卡、Apple Pay、Google Pay，原币原额退款。日元使用整日元，购买记录显示核实的含税实付总额。
- 退款复用站内客服审核：申请后暂停套餐权益，拒绝后恢复；批准后创建 Waffo 退款工单。提交工单不代表退款完成，须由 Waffo 后台继续审核执行。实际成功回调或金额一致的网关查询才完成本地退款。
- 外部全额退款撤回剩余权益；有使用或预留时冻结账户。部分或不明确退款保持人工核查和冻结。退款先到、完成支付后到不会再次发放权益。
- 订单查询、后台补查和既有 reconciliation cron 可恢复遗漏通知；回调路径在邀请限制中单独放行，由处理器验签，购买接口保留正常登录限制。

## 第一步：配置独立测试环境

在 Vercel **prompt-lens-v2-test** 项目配置测试站实际使用的环境。该项目的 Production 环境也属于测试项目，与主站项目不同。

```dotenv
WAFFO_PAYMENTS_ENABLED=false
WAFFO_PAYMENT_ENVIRONMENT=test
WAFFO_STORE_ID=STO_...
WAFFO_MERCHANT_ID=MER_...
WAFFO_PRIVATE_KEY=<Waffo 测试环境 RSA PEM 私钥>
WAFFO_TEST_PRODUCT_V6_TRIAL_200=PROD_...
WAFFO_TEST_PRODUCT_V6_CREATOR_650=PROD_...
WAFFO_TEST_PRODUCT_V6_VOLUME_1500=PROD_...
NEXT_PUBLIC_SITE_URL=https://<测试站域名>
```

- 测试门店、Key 和商品 ID 以 Waffo 后台为准；商户审核通过不代表测试/生产 Key 可互换。私钥只填 Vercel，勿提交 Git 或发到聊天。
- 三个商品分别为一次性套餐，CNY 税前基价 **34.90 / 89.90 / 199.00**。每个商品配置所需的 USD、JPY、HKD、EUR、GBP 价格项和支付能力，保留 CNY；同一套餐仍用一个商品 ID，无需按每个币种新增环境变量。外币价格由应用使用 priceSnapshot 按下单时的汇率覆盖，后台静态价格与直接购买链接另需保持合理。
- 核对三个商品所属门店、环境、价格、币种、发布状态及支付方式。外币必须实际出现银行卡选项并完成测试交易后才能验收；CNY 页面显示的支付宝与微信不能替代银行卡验收。结账使用 SaaS 税类，禁止优惠码；税费在 Waffo 最终结账页展示，本站核验订单币种、税前价和实付总额，不能原样替换币种代码。
- `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` 可能已被提示词审核使用；修改前核对审核服务兼容性。SDK 支持 PEM 中的换行及字面量 `\n`。
- Webhook 使用 SDK 内置对应环境的官方公钥，通常无需新增公钥。只有经 Waffo 官方确认的密钥轮换才设置 `WAFFO_WEBHOOK_TEST_PUBLIC_KEY` / `WAFFO_WEBHOOK_PROD_PUBLIC_KEY`。
- 原 `WAFFO_SANDBOX_CHECKOUT_ENABLED` 和 `/api/payments/waffo/sandbox-checkout` 已移除。

## 第二步：测试库迁移和 Webhook

1. 核对独立测试数据库目标，应用迁移 **0027_waffo_payments**（先确认此前迁移已应用）。新增 provider `waffo` 和私有事件表，不能对线上未知库直接执行 schema push。
2. 在 Waffo **测试环境**配置公开 HTTPS Webhook：`https://<测试站域名>/api/payments/waffo/webhook`。
3. 订阅 `order.completed`、`refund.succeeded`、`refund.failed`。回调不能被 Vercel Deployment Protection、Basic Auth 或其他边缘保护拦截；使用专用服务器访问方案，保留邀请用户白名单。
4. 确认 `CRON_SECRET` 及既有商业补查调度指向测试站，并已实际执行成功。此轮不自动修改 scheduler 或任何验收标志。
5. 测试站代码通过 Git 集成发布、迁移和配置核对完成后，将该测试项目 `WAFFO_PAYMENTS_ENABLED=true` 并重新部署，开始沙箱交易。

`test` 仅允许项目 `prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI`。生产门店和事件不能在此环境发放权益。

### 客源地区与结账币种

| 地区 | 默认建议 | 付款方式 |
| --- | --- | --- |
| 中国大陆 | CNY | Waffo 实际开放的钱包方式，当前截图为支付宝与微信 |
| 美国 | USD | 银行卡及可用数字钱包 |
| 日本 | JPY | 银行卡及可用数字钱包 |
| 香港 | HKD | 银行卡及可用数字钱包 |
| 奥地利等已映射欧元地区 | EUR | 银行卡及可用数字钱包 |
| 英国 | GBP | 银行卡及可用数字钱包 |
| 新加坡、印尼、加拿大、台湾、土耳其及其他/未知地区 | USD | 银行卡及可用数字钱包 |

用户可手动切换支持的币种。SGD、IDR、CAD、TWD、TRY 未在当前官方刷卡矩阵中，不声称这些币种可直接扣款。所有币种购买相同套餐时获得相同权益。

汇率通过官方 GraphQL `rate(fromCurrency: CNY, toCurrency: 目标币种)` 取得并校验币种方向、引用及有效期。缓存最长五分钟，汇率失效且无法获取新汇率时暂停创建外币订单，保留已有订单原价续付。人民币基价无换汇依赖。首次沙箱验证还需核对 `standardRate`、`rateRefId`、`expiryTime` 的实际响应格式和权限。

## 第三步：真实沙箱验收

以下项目均须收集实际证据，不能用本地 mock 通过替代：

- [ ] 邀请账户登录后看到已配置套餐，三种商品价格及税费显示一致。
- [ ] 美元银行卡支付出现可用卡入口并走通到账；日元整数金额、港币及欧元等所需币种各自验证，不能把本地界面 mock 当成银行卡渠道已开通。
- [ ] 地区建议币种和手动切换正确，汇率失败不猜价格；重开已有订单仍按原汇率与金额，退款按原币种含税实付总额。
- [ ] 从本站购买入口创建一笔测试订单，完成 Waffo 测试付款。
- [ ] Webhook 投递成功、本地订单 paid、钱包只增加一次、链接导入额度正确。
- [ ] 刷新或重开同一订单没有重复创建交易；重复投递和回跳不重复加权益。
- [ ] 本人可查订单；其他账户不能读取、续付或退款该订单。
- [ ] 模拟通知投递失败后恢复，验证补查或 Waffo 重发可以恢复到账。
- [ ] 退款申请、站内拒绝恢复、站内批准后 Waffo 工单审核执行、退款通知及钱包撤回走通。
- [ ] 超时或不符金额保持未确认；部分退款和使用后外部退款进入冻结核查。
- [ ] 既有支付宝订单仍可查看和按原渠道处理退款。

退款工单无法确认是否提交成功时，保留 review 和冻结权益，先按站内退款 ID 在 Waffo 查询；补查只读，不自动重新提交工单。Waffo 后台拒绝/失败也需人工跟进，不能将网关不确定结果自动当成安全恢复权益的依据。

## 补查与人工异常处理

付款补查读取 Waffo 官方 `webhookDeliveries` 中的原始事件证据并走相同校验事务，不用报价字段冒充实际付款。每笔订单 30 秒查询租约，每次最多读取门店 50 条投递；无法找到、查询不可用或事件证据不全时继续 pending，不虚报付款失败或到账。较早事件应由运营在 Waffo 后台按订单号定位并重新投递；网关默认排序、查询窗口和原始 payload 结构必须在沙箱验收。

仅支持官方已文档化的三个一次性订单/退款事件。SDK 未列出争议或拒付事件；生产前需与 Waffo 确认其通知渠道、运营负责人和处理流程。争议、非本站创建的退款、已使用权益及部分退款须核对实际资金、暂停相关账户消费并保留操作证据，不能依赖一个未文档化的事件名称。该运营验收尚未完成。

## 最后：正式收款

沙箱验收后，单独安排主站发布、正式库迁移和生产支付验收。Vercel **prompt-lens** 正式项目配置：

```dotenv
WAFFO_PAYMENTS_ENABLED=false
WAFFO_PAYMENT_ENVIRONMENT=prod
WAFFO_STORE_ID=STO_...
WAFFO_MERCHANT_ID=MER_...
WAFFO_PRIVATE_KEY=<Waffo 正式环境 RSA PEM 私钥>
WAFFO_PROD_PRODUCT_V6_TRIAL_200=PROD_...
WAFFO_PROD_PRODUCT_V6_CREATOR_650=PROD_...
WAFFO_PROD_PRODUCT_V6_VOLUME_1500=PROD_...
NEXT_PUBLIC_SITE_URL=https://<主站域名>
```

另配正式 Webhook 到主站相同路径、核对正式商品及实际收款/退款能力；审批正式开关后才启用。`prod` 同时要求项目 `prj_LA38e0saqqVw1OkQ95AyoMx5vjIV` 和 `VERCEL_ENV=production`，测试项目不能打开生产收款。

## 本地验证记录（2026-11-19）

- Waffo 交易用例 20 项通过，配置用例 3 项、空库迁移用例 1 项通过；覆盖签名、归属、币种、金额、重复/乱序、事务回滚、历史快照和退款。
- Playwright 桌面/手机结账及未配置状态共 3 项通过，使用拦截接口，无真实交易。
- TypeScript、变更代码 ESLint、生产构建通过；Node 调度/worker 回归 14 项通过。
- 全量 Vitest：1182 项通过、2 项跳过、3 项失败。失败为 `credits-byok-integration.test.ts` 的 BYOK/trial 进度失败提示两个用例，以及 `vercel-build-guard.test.ts` 对测试项目 `prompt-lens-V2` 分支的旧预期一个用例。在支付改动前提交 **2c6bff3** 的隔离源码上复现了同样 3 项失败；本轮未修改这些功能或部署分支规则。正式发布前仍需处理并复核。
- 线上迁移、真实 Webhook 可达性、SDK 查询响应、沙箱资金及生产资金链路均未验收；验收开关未作修改。

### 多币种增量验证

- Waffo 支付与退款扩展为 32 项用例，覆盖五种外币的锁价、刷卡参数、跨币种拒绝、汇率缺失/过期/方向错误、客户端伪造金额和日元含税实付及退款。
- 货币单位、地区建议和十进制换算 3 项通过；商业钱包/支付相关回归合计 207 项通过、1 项跳过，价格及教程说明另有 46 项通过。
- Playwright 美元/日元在 390px 和 1440px 的切换、续付、到账及汇率失败/未配置状态共 6 项通过。使用独立本地端口和模拟接口，无真实付款。
- 类型、变更代码 ESLint、生产构建通过。前述全量基线的三个已有失败保留记录；本轮未更改 BYOK 或部署分支守卫。
- 正式实收与真实汇率/银行卡环境仍待配置及沙箱验收，本轮未推送部署。

参考：[官方 SDK](https://github.com/waffo-com/waffo-pancake-sdk-ts)、[Webhook 文档](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/webhook-guide.md)、[查询文档](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/graphql-guide.md)、[ADR 0077](decisions/0077-waffo-payment-integration.md)。
