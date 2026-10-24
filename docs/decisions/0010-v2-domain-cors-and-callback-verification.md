# ADR 0010：测试域名的 R2 跨域规则与依赖地址核验

- 状态：R2 配置已修复，上传及关联地址核验通过
- 日期：2026-10-24
- 关联：ADR 0001、ADR 0007、ADR 0008

## 背景

用户在测试站上传视频时看到 `R2 upload failed. Check R2 CORS and your connection, then retry.`。应用已成功取得签名上传地址，浏览器直传阶段触发了通用网络错误。

读取现有桶配置确认，CORS 允许本地开发地址和 `https://prompt-lens.cc.cd`，遗漏了固定测试域名。带测试站 Origin 的 PUT 预检返回 HTTP 403 且没有跨域响应头；同样的请求在主站和本地 Origin 下都返回 HTTP 204。这说明此前只验证凭据、Worker 或环境变量，尚未覆盖浏览器跨域直传。

项目负责人要求将测试域名补充到实际需要的依赖配置中。

## 决策

- 在复用 R2 桶的现有上传 CORS 规则中，仅追加 `https://prompt-lens-v2-test.vercel.app`。
- 保留全部原有来源、GET/PUT/HEAD 方法、请求头、ETag 暴露和预检缓存时间。不修改桶的公开访问权限，不轮换密钥。
- 继续使用带鉴权的上传签名接口与两个邮箱的应用访问限制；浏览器来源许可与上传签名共同满足时才可上传。
- 统一核对测试环境的站点地址、认证地址、邮件链接、Worker 对账回调及支付宝通知地址。
- 新增测试域名时，将外部服务的域名许可检查和浏览器上传测试作为部署验收项，写入 AGENTS.md。测试入口继续使用固定域名，不采用覆盖全部 Vercel 站点的泛域名规则。
- 本次 R2 规则修改即时生效，无需重新部署 Web；不变更正式 Vercel 项目、主站域名或正式环境变量。

## 备选方案

- 只重试上传或重新复制 R2 凭据：无法补齐浏览器 Origin 许可，故障会继续出现。
- 允许任意来源：超出当前测试站需要的范围，不采用。
- 经由 Vercel 转发全部上传：改变现有直传架构，并受到请求大小与执行时限约束，本次不采用。

## 影响

- 测试域名可以使用现有签名直传流程。
- 共享 R2 配置只增加一项明确的浏览器来源，主站已有规则继续保留。
- 以后新增域名仍需显式核对 CORS 和对应回调；变量写入一致不能替代上传端到端验证。

## 验证计划与结果

- 修复前：测试站 Origin 的 PUT 预检 HTTP 403，主站与本地均 HTTP 204。
- 修改后回读完整 CORS，确认仅增加固定测试来源，原有规则字段保持一致。
- 修改后：测试站、主站及本地的 PUT 预检均 HTTP 204，返回对应 Origin 和允许的 content-type 请求头。
- 使用与应用相同的 AWS SDK 签名机制，向唯一诊断对象执行实际 PUT：HTTP 200，返回测试站的跨域响应头；通过服务端 HEAD 验证字节数一致。
- 仅删除本轮创建的诊断对象，清理成功；未改动已有用户文件。
- Vercel 测试项目 Production 环境中的 `NEXT_PUBLIC_SITE_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL`、`EMAIL_PUBLIC_SITE_URL`、`COMMERCIAL_RECONCILIATION_BASE_URL` 均回读匹配固定测试域名；`ALIPAY_NOTIFY_URL` 匹配该域名下的 `/api/payments/webhooks/alipay`。
- 应用可信来源读取已核验的站点及认证地址，因此固定测试域名已包含在认证可信来源中；Worker 媒体下载来源继续限定为配置的存储地址。
- 检查时测试站仍为 `dpl_35cfoHUVcmD71gdkqApjnZ6P7SMN`，主站仍为 `dpl_Dh4d9z2Wyu3LLJYU344BxSsjYtc9`。本轮未部署或推送。
