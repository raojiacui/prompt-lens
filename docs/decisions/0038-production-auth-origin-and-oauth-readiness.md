# ADR 0038：保留正式认证配置，以现有 OAuth 实测及 V2 回调校验准备发布

- 日期：2026-11-08
- 状态：2026-11-13 正式 V2 发布后，负责人反馈无痕窗口邮箱验证码、Google、GitHub 登录及进入工作台后刷新均成功；真实旧会话延续和旧 Key 调用仍分别验收。
- 关联：ADR 0031、0033、0034；上线过程记录第 008 项。

## 背景

负责人要求继续下一步上线准备。本项核对正式域名、登录地址、邮件地址、OAuth 回调、会话 Cookie 和邀请测试边界。当前正式站仍运行旧 `main` 部署，V2 尚未切换，必须区分现有正式应用可用与新版本端到端验收。

## 决策

1. 保留现有正式域名、认证密钥和 OAuth 应用配置，本次没有发现需要覆盖的正式配置项；不复制测试凭据或邀请白名单。
2. 根据 V2 实际读取的 `NEXT_PUBLIC_BETTER_AUTH_URL`、`NEXT_PUBLIC_SITE_URL` 和邮件运行配置核对有效地址，不仅检查环境变量名称。`TRUSTED_ORIGINS` 当前没有被认证源码读取，来源允许列表由源码及两项站点地址生成；不以该变量存在作为独立验证依据。
3. 通过独立 Better Auth 内存实例生成正式公开 Client ID 对应的授权地址，验证回调路径、state、PKCE、scope 和 Cookie 命名。此实例使用诊断用占位 Secret，不连接真实数据库、不发送邮件、不向第三方交换令牌，不将其结果当作真实 OAuth 授权成功。
4. 由负责人在无痕窗口验证当前正式 Google/GitHub 登录；发布到 V2 后仍需再次验收新认证链路，包括邮箱验证码实际送达、授权回跳、会话读取/刷新和工作台访问。
5. 保留现有测试邀请限制及恰好两个授权邮箱。本轮不取消限制以测试社交登录，不把邮箱登录通过等同于 Google/GitHub 在 V2 通过。

## 核查结果

| 项目 | 正式准备结果 |
| --- | --- |
| Vercel 域名 | `prompt-lens.cc.cd` 归属正式项目，verified=true，无额外域名重定向 |
| HTTPS | HTTP `/login` 返回 308 到 HTTPS；HTTPS 登录及认证页面可访问 |
| 认证基址 | `NEXT_PUBLIC_BETTER_AUTH_URL=https://prompt-lens.cc.cd` |
| 站点基址 | `NEXT_PUBLIC_SITE_URL=https://prompt-lens.cc.cd/`；规范化后与认证基址一致，末尾斜杠无需改动 |
| 邮件站点 | `EMAIL_PUBLIC_SITE_URL=https://prompt-lens.cc.cd` |
| Google 回调 | `https://prompt-lens.cc.cd/api/auth/callback/google` |
| GitHub 回调 | `https://prompt-lens.cc.cd/api/auth/callback/github` |
| OAuth 凭据 | 正式 Google/GitHub Client ID 及 Secret 均存在、非空，无首尾多余空白；Google Client ID 格式符合所查类型 |
| 认证密钥 | `BETTER_AUTH_SECRET` 存在且不少于 32 字符，保留原值；未增加会改变旧密文解密路径的 BYOK 密钥 |
| 正式访问限制 | 未配置 `ACCESS_ALLOWED_EMAILS`，保留公开站点行为 |
| 测试访问限制 | 恰为 `raojiacui@gmail.com`、`raojinbo@gmail.com`，未改动 |

- 正式与测试的 Google Client ID、Secret 均不同；正式继续使用自身配置。测试未配置 GitHub 凭据，且当前邀请限制会隐藏社交登录入口并在 API 返回 403；该测试模式没有验证 V2 正式社交登录。
- 独立内存实例使用当前仓库 Better Auth 依赖生成两个回调，均与上表精确匹配；Google scope 为 `email profile openid`，GitHub scope 为 `read:user user:email`，两者均带 state 和 PKCE。只在进程内存产生 2 条验证记录，没有写入线上库。
- 旧正式源码的 Cookie 自定义名称与 V2 `cookiePrefix=better-auth` 在 HTTPS 下都生成 `__Secure-better-auth.session_token`，Secure、HttpOnly、SameSite=Lax、Path=/ 一致。本项不修改 Cookie 或密钥；命名兼容性不替代真实旧会话在新部署中的验证。
- 正式与测试的 `/api/auth/ok` 均返回 200，匿名正式 `/api/auth/get-session` 返回 200/null；HTTPS 校验正常。此类健康和匿名请求不证明实际登录成功。
- 负责人通过本轮问题明确反馈：**在无痕窗口当前正式 Google 和 GitHub 登录均成功回到工作台**。记为现有正式 OAuth 应用及回调的用户实测证据，没有把该反馈扩展为尚未部署的 V2 全流程通过。
- 先前新 SMTP 凭据的连接认证已验证通过，但 Vercel 环境变量不会回写到旧部署。新版邮件模块及新配置需在正式 V2 部署后验证验证码实际送达和登录；本轮没有发送验证码或邮件。
- 公开邮件图片仍沿用第 003/005 项确认的开发桶公共资源，本次不迁移、替换或删除。

## 2026-11-13：正式 V2 登录实测反馈

- 已发布来源为 prompt-lens-V2 / 4b72c11，正式部署为 dpl_HwZTbgK5hexvVuMj3HmzqjwchYSa。负责人按检查要求，在无痕窗口分别测试邮箱验证码、Google、GitHub 登录，确认进入工作台并刷新后保持登录，明确回复“都成功的”。
- 以负责人实际操作反馈记录三种登录路径通过；助手没有读取验证码、Cookie、令牌或账号密码，没有代发登录邮件或修改认证配置。
- 本次无痕测试不证明发布前旧 Cookie 的延续，也不替代旧 Key 真实调用、普通账号两次试用、付费模型或支付验收。下一步以负责人可用的普通非管理员账号核对试用额度，不使用管理员不限次结果代替。

## 原备选方案

- 从测试整包复制认证配置：会改变正式用户会话、OAuth 应用、访问范围和旧密钥解密路径，不采用。
- 因 V2 测试站只开放邮箱验证码而忽略正式社交登录：缺少正式预期行为的证据，不采用；记录当前正式用户实测及发布后验收待办。
- 仅靠环境变量存在、健康检查或生成授权 URL 判定登录通过：无法证明第三方授权及令牌交换，不采用。

## 验证与影响

- 当前仓库 6 个相关测试文件、48 项通过，覆盖真实内存会话、缓存刷新、邀请访问策略、邮件地址和 OTP 模板；不连接生产数据库或真实 SMTP。
- 正式域名仍指向 `dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV`，本次没有修改域名、凭据、白名单、会话、数据库、Worker 或部署。Google/GitHub 的实际登录由负责人亲自完成。
- 临时诊断、HTTP 检查及测试结果放在被忽略的 `temp/`，不存储真实 Secret、令牌、Cookie 值或私密用户信息；仅本地提交本记录和上线文档，不额外推送 V2 触发部署。
- 回调约定参考 [Better Auth Google 文档](https://better-auth.com/docs/authentication/google) 和 [GitHub 文档](https://better-auth.com/docs/authentication/github)，同时通过当前本地依赖确认，不按其他框架的回调路径改配置。
