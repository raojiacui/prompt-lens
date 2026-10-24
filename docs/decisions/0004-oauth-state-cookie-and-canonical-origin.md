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

## 备选方案

### 继续使用数据库 state，仅调整登录页

可以减少重复点击导致的覆盖，但仍保留数据库记录和浏览器 state cookie 生命周期不一致、跨域 Cookie 丢失两类风险。

### 启用 `skipStateCookieCheck`

可以绕过当前错误，但会削弱 OAuth 的 CSRF 与回调绑定保护，因此拒绝采用。

### 为预览部署配置 OAuth Proxy

适合让每个 Vercel Preview 域名都完成 OAuth。当前任务只覆盖 main 主站，增加代理会扩大认证基础设施和维护范围，暂不采用。

## 影响

- OAuth 登录必须在同一主域名完成，生产别名会先跳转到 `prompt-lens.cc.cd`。
- 同一浏览器在十分钟内只能保留一轮 OAuth state；登录页会阻止本页面产生并发请求。
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
