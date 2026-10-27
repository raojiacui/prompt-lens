# ADR 0011：恢复 V2 媒体 Worker 存储配置并明确预处理错误

- 日期：2026-10-27
- 状态：线上存储配置已恢复并验证；错误处理补充代码已本地验证

## 背景

V2 测试站点击开始分析后，前端显示通用的请求未完成提示。隔离数据库中的两条 `analysis_preview` 任务分别于 14:14 和 14:21 UTC 失败，诊断为 `MEDIA_PREPARATION_FAILED → MEDIA_HTTP_500 → Invalid URL`。Fly 日志定位到 Worker 对配置存储地址列表执行 URL 解析时收到字符串 `False`。完整脱敏检查发现 `R2_PUBLIC_URL`、`R2_ACCOUNT_ID`、`R2_BUCKET_NAME`、访问 Key ID 和 Secret 都被写为 `False`，`WORKER_SECRET` 未受影响。

请求已通过登录和购买资格校验，故障发生在预处理且尚未创建分析报价或预留分析积分。GitHub OAuth 缺少凭据的警告同时出现，但不构成本次故障的根因；GitHub 登录凭据缺失仍是其独立验收阻塞项。

## 决策

- 只修复 Fly 应用 `prompt-lens-v2-worker` 的 R2 配置。采用本地已有、经测试桶身份和 HeadBucket 200 验证的存储配置；账号匹配 `e2b9b0346c8b919a93da8c414f1766b1`、公开域名匹配 `pub-838ceb4cc82146c2b99d5f06b4751da6.r2.dev`、桶名必须包含 test/dev。保留既有 Worker 鉴权和对账配置，不读取或改动正式 Worker。
- 配置通过 Fly stdin 导入，密钥不写入命令行、提交或输出；禁止用布尔值、空值或缺失值代替不可读的密钥。单独记录并检查显式 HTTPS R2 Endpoint。
- Worker 将存储配置错误标记为 `MEDIA_STORAGE_CONFIG_INVALID`，区分用户输入地址错误；错误仅包含字段名称，不包含配置内容或签名 URL。下载仍严格限制为已配置存储主机，保留鉴权。
- Web 将预处理基础设施失败返回服务错误并输出脱敏诊断；前端明确显示视频预处理不可用和未开始分析，401 则显示重新登录提示。保留报价后确认、购买资格检查、幂等任务 ID 和不自动重复提交付费任务的边界。
- Web 修复只部署到 `prompt-lens-v2-test`；主站部署 ID 在操作前后必须一致。保留本地已有未提交的 ADR 0001 文案和无关脚本。

## 备选方案

- 重新登录或填写 GitHub OAuth 凭据：不能修复 Worker 中的 `False` 存储配置，GitHub 凭据需要独立补齐。
- 跳过存储来源校验、关闭拆镜或切换成免费/自带 Key 流程：会改变正式产品行为或削弱安全边界，不采用。
- 自动重提付费任务：本次尚未进入付费确认流程，不需要承担重复扣费风险。

## 影响

恢复预处理依赖后，才能继续真实的平台积分分析验收；基础设施恢复不代表整条付费流程验收通过。新增错误码不暴露存储凭据。对非法或不受支持的媒体地址继续拒绝处理。

## 验证

- 已确认：故障任务状态为 failed、种类为 analysis_preview；Fly 堆栈指向存储地址解析，输入为 False；本地测试存储 HeadBucket 返回 200。
- 已确认：22 项相关回归和 TypeScript 检查通过。
- 2026-10-27 已经通过标准输入恢复测试 Worker 的六项 R2 配置，Fly 确认唯一实例滚动更新成功；没有修改 Worker 鉴权、对账配置或正式 Worker。
- 使用唯一三秒 H.264 合成视频，在测试桶执行上传，按 Web 同样的 path-style 格式签名 GET 后交给真实 V2 Worker 自动拆镜，返回 HTTP 200、durationUs=3000000、sceneCount=1、有效 sourceHash。本轮只清理自身生成的测试对象，未调用模型或扣分析积分。
- 未发布 Web 或 Worker 的错误处理补充代码，保持正在进行的任务运行。主站部署仍为 dpl_4krAk8XyuoEKq48YhDHZ2fUak3X6；完整用户分析、支付和登录验收不因预处理恢复而标记通过。
