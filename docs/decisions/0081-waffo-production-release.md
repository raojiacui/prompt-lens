# ADR 0081：Waffo 正式支付发布

- 日期：2026-11-20
- 状态：负责人再次确认准备正式站；已有两笔沙箱美元支付及唯一到账证据，正式配置待补齐，主站未发布。

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

### 负责人完成测试付款后的复核

2026-11-20 再次准备正式站时确认，体验包 USD 5.23 测试订单 `32f0c35b-45e1-4722-b7ca-1fefd9d16579` 和 `550fa448-802c-41e5-9b99-c61bd10bae02` 均 paid；每笔各有一条接受事件及一份商业权益批次。该证据覆盖测试付款与唯一发放，不等同于退款或正式资金验收。

正式库复查事件表、RLS、anon 无读取权限、authenticated 无写权限符合预期，生产事件 0。正式项目环境变量元数据仍只有审核相关 merchant/key/scan 配置，缺支付环境、门店、三档正式商品和开关；缺失配置仍为启用生产收款的阻塞项。

正式分支远端仍为 `6af28cce4dcc1fb5c88ccab3567f415898d4e88e`，主站仍为 `dpl_5pvcy1GTM9Txr7DoC9aGd6HcRiBF`；已验证测试部署为 `6546c7a8aaf63baf62dc2d8740eb230d2425b2dc`。在负责人配置正式变量和生产 Raw Webhook 前，不推送正式发布，不改动审核变量、部署保护或邀请限制。

配置步骤见 `docs/waffo-production-setup.md`。另有一笔旧待付款订单记录过 `WAFFO_QUERY_UNCONFIRMED`，最新成功付款无该错误；支付状态补查仍须在正式启用前复核，不能仅凭成功回调宣告所有补偿查询均已验收。

### 正式配置完成后的 Git 发布预检

负责人确认正式变量及生产 Webhook 均已填写。元数据确认 prod 环境、门店、三档 PROD 商品、merchant/key 与开关均已出现在正式项目 Production，敏感值未读取或打印。补齐此前缺失的 `NEXT_PUBLIC_SITE_URL=https://prompt-lens.cc.cd`，复查为仅 Production 的 plain 变量；显式保持支付开关 false。

正式发布使用隔离工作树 `tmp/waffo-production`，`.vercel/project.json` 明确绑定 prompt-lens / prj_LA38e0saqqVw1OkQ95AyoMx5vjIV，避免把原测试工作区误绑定正式站。49 项支付/配置/币种/迁移回归及类型检查通过。业务代码与已测试 6546c7a 一致，新增仅发布记录、配置测试与说明。

发布前主站为负责人配置变量后 redeploy 的 `dpl_FnKwWPa2i3iSzMpZzQFU6y1hQXd4`，仍为旧业务 SHA 6af28cc；正式 Git 远端未发生其他更新。接下来只推送正式 Git 分支，不手动上传/提升。发布后验证收款关闭、主站地址和回调门禁，生产报价与实际交易仍待启用验收。

### 正式代码发布结果

- 发布提交 `303e446edf2e692b4ae95b5abaad7a3124c0a803` 已推送 `prompt-lens-V2`，远端 SHA 一致。部署 `dpl_BpJPckbRfTyTAjjL2zQJmnEBeA9B` 为 READY / source=git / production，正式域名 prompt-lens.cc.cd 指向同一 Git 提交。
- 自动审批初次将授权理解为仅准备而拦截推送；补充负责人前文明确“可以上生产”和随后确认配置完成的完整授权证据后，同一 Git 推送通过复核。未绕过审批或改用其他发布方式。
- 无登录真实 HTTP 检查：/pricing 为 200；/api/payments/waffo/checkout 为 200、enabled=false、packages=[]；POST 空 JSON 至正式 Webhook 为 503 / WAFFO_NOT_ACTIVE，符合收款尚未启用状态。网络沙箱默认代理端口 9 导致初次探测失败，使用获准网络执行后才取得上述证据。
- 正式新部署错误日志查询为空。测试固定域名仍为 `dpl_14basz1JhvjXfU4FoWXPiupfMg5A` / `6546c7a8aaf63baf62dc2d8740eb230d2425b2dc`，测试开关和数据未改动。
- 本次仅代码上线及关闭门禁验证；正式商品/密钥的真实网关校验、生产外币报价、真实付款与原币退款仍待开启后验收。没有代负责人发起真实扣款。
