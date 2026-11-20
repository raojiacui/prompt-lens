# Waffo 正式站配置

目标为 Vercel **prompt-lens** 的 **Production** 环境和 `https://prompt-lens.cc.cd`。测试项目 `prompt-lens-v2-test` 保持原配置。

## 商品与环境变量

先在 Waffo 切换到生产模式，确认体验包、创作包、大容量包三个一次性商品均已发布；读取生产模式下的商品 ID。人民币基价分别为 34.90、89.90、199.00，其他币种仍由本站按人民币基价自动换算。

在 Vercel 正式项目填写：

```dotenv
WAFFO_PAYMENT_ENVIRONMENT=prod
WAFFO_PAYMENTS_ENABLED=false
WAFFO_STORE_ID=STO_0ziLkni30rLqFz6vZ6NRvd
WAFFO_PROD_PRODUCT_V6_TRIAL_200=<正式体验包 PROD_...>
WAFFO_PROD_PRODUCT_V6_CREATOR_650=<正式创作包 PROD_...>
WAFFO_PROD_PRODUCT_V6_VOLUME_1500=<正式大容量包 PROD_...>
NEXT_PUBLIC_SITE_URL=https://prompt-lens.cc.cd
```

确认已有 `WAFFO_MERCHANT_ID` 和 `WAFFO_PRIVATE_KEY` 对应正式环境 API 凭据；不要用测试私钥覆盖审核使用的正式私钥，也不要将私钥发到聊天或提交 Git。若这些凭据同时用于审核，修改前需确认审核调用兼容性。

## 生产通知

Waffo **生产模式 → 设置 → Webhooks**：

- 格式：Raw。
- 端点：`https://prompt-lens.cc.cd/api/payments/waffo/webhook`。
- 事件：`order.completed`、`refund.succeeded`、`refund.failed`。

已有测试模式 Webhook 保留。正式通知与测试通知由各自环境公钥验签；不把测试付款通知当作正式权益发放依据。

## 发布顺序与验收边界

正式库准备已完成，当前不需要重复迁移。变量和 Webhook 配好后，核对正式配置，再通过正式 Git 分支发布代码并确认域名来源、回调入口及生产报价。生产开关先为 false，具备配置和验证条件后再启用。未完成真实生产付款、唯一到账和退款核对前，不宣告正式资金链路验收通过；实际扣款由负责人操作。

测试证据：两笔 USD 5.23 体验包订单各接受一条成功事件、发放一份权益。其他币种的报价、结账入口已有测试，不能据此宣告每个币种或退款均已完成端到端验收。旧订单的补查异常需要继续核对，不通过删除异常记录、放宽金额校验或修改验收标记来通过发布检查。
