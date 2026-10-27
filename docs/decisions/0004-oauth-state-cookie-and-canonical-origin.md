# ADR 0004：OAuth 状态使用加密 Cookie 并固定生产域名

- 状态：已采纳
- 日期：2026-10-24

## 背景

生产日志出现 Better Auth `state_security_mismatch`，错误信息为 `State mismatch: State not persisted correctly`。原配置使用数据库保存 OAuth state；回调能找到数据库记录，但浏览器中的短期 state cookie 缺失、过期或被另一轮登录覆盖时，Better Auth 会拒绝回调。

当前登录页还直接请求服务端登录接口，并允许用户在跳转完成前重复点击或切换提供商。生产项目同时存在自定义域名和 Vercel 部署别名；用户从别名发起登录、再回到自定义域名时，域名级 Cookie 无法随回调带回。

首次修复上线后，日志出现新的 `state_mismatch`，错误信息为 `auth state cookie not found`。排查确认服务端回调已固定到主域名，但浏览器端 Better Auth Client 仍按 `window.location.origin` 发起请求；部署前已打开的旧页面仍可能从 Vercel 别名写入 state Cookie，随后回调到主域名并丢失该 Cookie。

## 决策

1. 将 `better-auth` 精确固定为 `1.6.2`，使用该版本包含的 OAuth state-cookie 绑定修复，避免补丁版本漂移改变认证行为。
2. 配置 `account.storeStateStrategy: "cookie"`，让加密的 state、PKCE verifier 和回调信息由一个十分钟有效的 `SameSite=Lax`、`Secure` Cookie 保存和校验。
3. 登录页统一调用 Better Auth 客户端的 `signIn.social`，发起登录后禁用 Google 和 GitHub 两个按钮，阻止并发登录覆盖 state cookie。
4. Vercel 生产环境固定使用 `https://prompt-lens.cc.cd` 作为 Better Auth base URL，并在页面中间件把生产部署别名跳转到该主域名。非生产环境仍可使用 `BETTER_AUTH_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL` 或 `NEXT_PUBLIC_SITE_URL`。
5. 保留完整 state 校验，不启用 `skipStateCookieCheck`。
6. 登录页由服务端把当前环境的 Better Auth base URL 传给客户端。客户端在页面加载及点击登录时分别检查一次来源域名；生产别名会整页跳转到主域名，再允许发起 OAuth。
7. OAuth 登录接口增加服务端兜底。生产别名对 `/api/auth/sign-in/social` 的 POST 请求返回 `409 OAUTH_CANONICAL_ORIGIN_REQUIRED`，不创建 state Cookie；这可以拦截部署前已加载、仍运行旧前端代码的页面。该限制只作用于生产 OAuth 发起请求，不改变预览环境和其他认证接口。

### 2026-10-28：隔离并发登录并恢复过期回调

- 主站 2026-10-27 23:52（北京时间）的新错误来自 GitHub 回调，域名已经是 `prompt-lens.cc.cd`。日志只能证明请求没有带回 state Cookie，无法确认用户当时的标签页操作或浏览器设置。
- 使用已安装的 Better Auth 1.6.2 处理器复现了共享 Cookie 的风险：两轮登录共用 `oauth_state`，后一轮覆盖前一轮；一轮完成并删除 Cookie 后，另一轮回调出现 `auth state cookie not found`。原来的单页面按钮禁用无法阻止其他标签页发起登录。
- 在认证路由边界按 state 的 SHA-256 摘要给每轮登录的 Cookie 命名。加密值、十分钟期限、HttpOnly、Secure 和 SameSite=Lax 属性保持不变。回调只将匹配的 Cookie 映射回 Better Auth 预期名称，并只清理对应的一轮。
- Cookie 名摘要仅用于选择请求，不作为认证凭证。Better Auth 继续解密、核对随机 state、期限和 PKCE，并验证提供商授权码；任何检查失败都无法创建会话。不关闭 CSRF、来源或 state 检查。
- 每次新登录从浏览器已知的待处理 Cookie 中保留最近三轮，删除更早的 Cookie，控制请求头大小。部署前签发的旧 Cookie 仍兼容至其原有效期结束。
- 缺失、重复使用或过期的 state 回调返回本站登录页，显示重新发起登录的说明；不自动交换授权码、不自动重试外部授权，不创建临时会话。缺失 Cookie 的记录仅包含提供商和原因，不记录 Cookie、state 或授权码。
- 已有三十天登录会话、数据库和 OAuth 提供商配置保持原逻辑。浏览器禁用本站 Cookie、跨浏览器完成授权或已过期的流程仍须由用户重新发起登录。
- 备选方案为跨标签页客户端锁；该方案无法覆盖旧页面和直接访问接口，且需要处理关闭页面后锁恢复，因此选择服务端按轮次隔离。只隐藏错误日志不能解决覆盖问题，不采用。

## 备选方案

### 继续使用数据库 state，仅调整登录页

可以减少重复点击导致的覆盖，但仍保留数据库记录和浏览器 state cookie 生命周期不一致、跨域 Cookie 丢失两类风险。

### 启用 `skipStateCookieCheck`

可以绕过当前错误，但会削弱 OAuth 的 CSRF 与回调绑定保护，因此拒绝采用。

### 为预览部署配置 OAuth Proxy

适合让每个 Vercel Preview 域名都完成 OAuth。当前任务只覆盖 main 主站，增加代理会扩大认证基础设施和维护范围，暂不采用。

## 影响

- OAuth 登录必须在同一主域名完成，生产别名会先跳转到 `prompt-lens.cc.cd`。
- 同一浏览器可保留多轮独立的 OAuth state；新登录按上述规则清理更早的已知轮次，登录页仍阻止本页面重复点击。
- OAuth state 不再写入数据库 verification 表，减少一次写入和一次读取。
- 已经从旧流程发起且尚未完成的 OAuth 回调可能失效，用户重新点击登录即可恢复。
- 生产别名中的新页面会跳转到主域名；旧页面直接调用 OAuth 接口会收到可识别的 `409`，避免生成必然无法在主域名回调中读取的 Cookie。
- V2 测试项目和 Vercel Preview 不会触发生产域名兜底，继续使用各自的认证来源。
- 主域名变更时，必须同步更新 `DEFAULT_PRODUCTION_ORIGIN`、OAuth 提供商回调地址和本 ADR。

## 验证计划

- 单元测试验证生产主域名选择、部署别名页面跳转、生产别名 OAuth POST 拦截，以及预览环境不受影响。
- 源码约束测试验证登录页使用 `signIn.social`、禁用并发点击、点击前执行主域名检查并固定 Better Auth 版本。
- 集成测试发起真实 Better Auth Google 登录请求，检查 state cookie 的安全属性，再携带同一 cookie 调用回调，确认不会返回 `state_mismatch`。
- 运行 TypeScript 检查、非 E2E 测试集和 Next.js 生产构建。
- 部署后从主域名新开登录页完成 Google 登录，并观察 Vercel 日志中的 `state_security_mismatch` 与 `state_mismatch`。如果再次出现，记录请求域名、提供商、请求 ID 和用户是否使用多个标签页，再继续定位。
- 集成回归验证共享 Cookie 原问题、Google/GitHub 并发与倒序回调、同提供商并发、仅在提供商授权码校验成功后创建会话、错误加密值、过期、重复回调、旧 Cookie 和数量清理；测试使用内存适配器并模拟外部提供商，不能替代用户浏览器的真实授权验收。

## 2026-10-28 修复验证

- 认证、主域名和登录界面的最终定向检查 26 项通过；包含三十天会话保留、PKCE 与 state 安全拒绝用例。
- Next.js 生产编译、类型与页面生成通过。实际 Next.js HTTP 路由检查验证了 Google/GitHub 两轮 Cookie 往返、倒序回调、重复回调拒绝和登录恢复参数，全程使用合成配置、未连接生产数据库。
- HTTP 检查同时修正了 Next.js 请求代理无法直接复制的兼容性问题；恢复跳转显式使用认证域名，避免框架内部主机名出现在跳转地址中。
- 当前线上事件的具体用户操作仍无法从日志还原；此修复覆盖已复现的共享 Cookie 覆盖路径，并为缺失、过期和重复回调提供恢复。真实浏览器的提供商授权登录仍需要上线后验证。
