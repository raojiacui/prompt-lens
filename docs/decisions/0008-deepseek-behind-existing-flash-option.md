# ADR 0008：现有 Flash 选项改用 KIE DeepSeek V4.1 Flash

## 背景

Gemini 3.8 Flash 经 KIE 的生产请求出现 500、503、504 和超时；部分图片下载错误另由 ADR 0007 处理。用户明确要求前端继续显示 Gemini 3.8 Flash，后端实际使用 `deepseek-v4-1-flash`。

## 决策

- 保留 `platform-gemini-3.8-flash`、`kie-gemini-3.8-flash` 前端 ID 和文案，两者在可信服务端映射到 `deepseek-v4-1-flash`。平台配额与用户自有 Key 的支付来源保持原行为，其他模型选项保持现有通道。
- 使用 KIE 官方 `/openai/v1/responses`，将文本和帧分别放入 `input_text`、`input_image`；保留 ADR 0007 的 JPEG base64 输入，不恢复公网 R2 拉取。
- 设置 `reasoning.effort: none`，优先当前视觉提示词任务的响应速度；不发送此模型不支持的 `max_tokens`、`max_output_tokens`、`temperature` 或 `include_thoughts`。
- 复用现有原生 fetch、流式传输和有限重试；新增 Responses JSON/SSE 解析，仅读取 assistant 的 `output_text`，忽略 reasoning。流式结果必须收到完成事件，失败、未完成、截断结果不保存为成功。
- 操作日志保留前端选项 ID，并记录实际模型名和通道；前端显示名称与实际模型不同的行为由本 ADR 明确记录。删除被替代的 Gemini 3.8 通道及专用调用函数。

## 备选方案

只替换模型字符串会沿用不兼容的 Chat Completions 格式，不能采用。直接切 DeepSeek 官方接口需要新的 Key、模型名和供应商配置，本次继续使用用户选定的 KIE。前端改名更直观，但不符合本次用户指定的显示要求。

## 影响

新模型的分析内容、耗时和计费可能不同，切换不保证消除 KIE 自身故障；保留现有有限重试，不新增无界重试或静默回退。底层模型名用于诊断和成本追踪，前端名称继续沿用用户指定的旧名称。

## 验证计划与证据

- 官方依据：https://docs.kie.ai/market/deepseek-v4-1-flash 及 https://kie.ai/deepseek-v4-1-flash 。确认图片理解支持公网 URL 和 base64 data URL，接口为 Responses。
- 回归覆盖两种 Key 来源、图片顺序、其他 Gemini 通道、Responses 完成与失败事件、流中断、错误重试和最终结果不重复。
- 使用显式开启的真实 KIE 测试：两张不同颜色的合成 JPEG，要求按顺序识别颜色；再调用正常分析流水线处理八张合成帧，检查完整提示词与核心提示词。测试不涉及用户素材或生产存储。
- 2026-10-26：真实 KIE 测试通过。两张 128×128 红色、蓝色 JPEG 直接通过 base64 输入，模型按输入顺序识别颜色，首个请求约 4144 ms；八张合成帧（两张图片重复四次）通过实际 `analyzeFrames` 流水线返回提示词与核心提示词。两次调用合计测试耗时约 13.2 秒，未打印 Key 或完整图片内容。
- 相关回归 51 项通过；全量非 E2E 回归 191 项通过、4 项显式开启的真实服务测试默认跳过；新增真实 DeepSeek 测试另行显式开启并通过。独立 TypeScript 检查与 Next.js 生产构建均成功。
- 本地构建存在既有工作区根路径、Browserslist 数据和 GitHub OAuth 凭证缺失提示；没有关闭登录提供商或修改生产配置。本次结果不构成登录 E2E 验收。
- 本次先提交本地代码。推送、生产发布与主站登录后的真实视频验收尚未执行。
