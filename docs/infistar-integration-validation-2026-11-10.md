# Infistar 接入验证记录（2026-11-10）

本次只做本地开发、验证和提交，没有推送、部署或迁移远端数据库。品牌 Logo 尚待用户提供，配置卡与推荐表格暂用品牌文字。

| 项目 | 已收集证据 | 验收状态 |
| --- | --- | --- |
| Key 归属与首选供应商 | 独立保存、服务端加密；保留既有 KIE 偏好；按任务供应商和指纹查询；隔离测试通过 | 本地通过，真实数据库流程待验证 |
| Infistar 模型权限 | 真实 `/v1/models` 返回 200；发现 auto 分组可调用的可灵/即梦未列出，保留已核实的独立模型配置并由实际请求判定权限 | 真实读取与请求核实通过 |
| 文本对话 | Gemini 3.8/3.7/3.6/3.5 Flash、DeepSeek V4.1 Flash 均返回 200 与 `OK` | 五款最小调用通过 |
| 视觉分析与提示词改写 | 供应商路由、图像消息、结果校验、重试与计费边界测试通过 | 真实推理待验证 |
| 文生视频 | 即梦 3.0/Pro、可灵 3/Omni/Turbo/O1、Seedance Mini/Fast/标准版、Wan 2.7、MiniMax-H3 均完成最小任务 | 十一款最小调用通过 |
| 图生视频 | Wan 2.7 i2v 使用合成 PNG 的 multipart 二进制输入，任务完成并返回视频地址 | 最小调用通过 |
| 参考视频与生成式编辑 | MiniMax-H3 的 2K、5 秒视频文件输入受理后任务失败，metadata 显示 REFUNDED、final_quota=0 | 真实失败，参考/编辑验收阻塞 |
| 音频转写 | Qwen FileTrans 合成人声返回 200、`hello world.`；即便请求 verbose_json 仍仅返回 task/text | 最小识别通过，字幕时间戳验收阻塞 |
| 独立音频生成与旧剪辑入口 | 保持现有 V2 的 410 发布状态 | 本次未开放，不宣传为已上线 |
| 首页公告与 API 配置页 | 中英文、1440px/390px；公告关闭后刷新记忆、专属链接、保存及首选切换，共 6 项浏览器测试通过 | 本地界面通过，API 数据使用隔离夹具 |
| README | 现有产品标识、大标题、左右推荐表格、两家专属链接 | 文案与链接完成，品牌素材待替换 |
| 数据库迁移 0025 | 隔离 PGlite 验证保留旧密文、新增枚举与首选唯一约束；只读检查已补充对应结构 | 远端未应用，部署前必须执行 |
| 全量自动检查 | 1001 项 Vitest、12 项 Node 测试通过；2 项按需测试未运行；生产构建通过 | 不代表线上完整验收 |
| 本轮最小请求后的修正 | 模型目录、鉴权、真实完成响应、分辨率与音频时间戳共 21 项定向测试，TypeScript 检查通过 | 本地回归通过 |

## 已观察到的限制

- 真实 Key 的 `/v1/models` 未列出即梦 3.0/Pro 与可灵 v3/Omni/Turbo，但同一 Key 在 auto 分组的实际 POST 成功并完成任务。因此该列表用于凭据校验与已列出 ID 核实，不能作为已验证视频配置的排他白名单。未知且未配置的型号仍拒绝提交；实际权限错误直接显示，不切换供应商。
- Seedance Mini 的 4 秒、480p 请求被服务商拒绝，5 秒、720p 请求成功。不能仅凭模型家族名推断所有参数组合可用。
- Wan 2.7 的 2 秒、720p 请求曾返回需要 1.20 元、账户余额 1 元，没有创建任务。
- 用户最初设置人民币 5 元联调上限，随后明确表示无需受该费用限制、余额足够，授权继续必要的小样本真实验证。不充值；不将单次返回成功当作实际账单已核对。
- 即梦 Pro 的 720p 请求明确拒绝，改为 1080p 后完成；MiniMax-H3 的 1080p 请求拒绝，2K 视频参考请求受理后失败。配置同步为 Pro 1080p、MiniMax 2K；可灵 2.6 返回 503、auto 分组无通道，从 Infistar 备选清单移除，KIE 清单保持不变。
- 可灵与即梦的完成响应为顶层 status/id 加 `data: [{url}]`；已补充解析与回归测试。对这六款任务另行只读检查 `/content` 均返回 200、video/mp4 与实际字节，未重复提交任务。
- Gemini 3.7/3.8 的早期视觉请求因本地工具超时未保留结果，不据此判断视觉能力；文本最小请求全部成功。视觉、参考/编辑、带时间轴音频及受邀用户端到端流程不能标记为已验收。

## 逐模型最小请求结果

遵照用户要求，每款只做最小调用；服务商明确拒绝且未建任务的分辨率错误修正后补一次。已受理的视频只查询原任务，不重提。Gemini 3.7 在早期视觉结果丢失后另做一次最小文本核实。临时请求脚本、测试音视频、任务明细和结果均存于 Git 忽略的 `tmp/infistar/model-probes/`，不包含于功能提交。

| 精确模型 ID | 最小输入 | 结果 |
| --- | --- | --- |
| gemini-3.8-flash | 简短文本 | 200，OK |
| gemini-3.7-flash | 简短文本 | 200，OK |
| gemini-3.6-flash | 简短文本 | 200，OK |
| gemini-3.5-flash | 简短文本 | 200，OK |
| deepseek-v4.1-flash | 简短文本 | 200，OK |
| jimeng-video-3.0 | 5 秒，720p，文本 | 完成，可下载 |
| jimeng-video-3.0-pro | 5 秒，1080p，文本 | 完成，可下载 |
| kling-v3 | 5 秒，720p，文本 | 完成，可下载 |
| kling-v3-omni | 5 秒，720p，文本 | 完成，可下载 |
| kling-3.0-turbo | 5 秒，720p，文本 | 完成，可下载 |
| kling-video-o1 | 5 秒，720p，文本 | 完成，可下载 |
| kling-v2-6 | 5 秒，720p，文本 | 503，无可用通道，未建任务 |
| doubao-seedance-2.0-mini | 5 秒，720p，文本 | 完成，HTTPS 结果 |
| doubao-seedance-2-0-fast-260128 | 5 秒，720p，文本 | 完成，HTTPS 结果 |
| doubao-seedance-2-0-260128 | 5 秒，720p，文本 | 完成，HTTPS 结果 |
| wan2.7-t2v | 5 秒，720p，文本 | 完成，HTTPS 结果 |
| wan2.7-i2v | 5 秒，720p，合成红色图片 | 完成，HTTPS 结果 |
| MiniMax-H3 | 5 秒，2K，文本；另测合成参考视频文件 | 文生完成，结果下载 200、video/mp4、收到实际字节；参考视频受理后失败并退款 |
| qwen-audio-3.0-asr-flash-filetrans | 本地合成 hello world 人声 | 200，识别成功；无时间戳 |

## 补充核实：当前清单均可最小调用

用户再次要求核实全部模型后，仅对尚未成功的 MiniMax-H3 补发一次基础文生视频请求：5 秒、原生 size=2K，不携带参考文件。任务从 queued、in_progress 到 completed，metadata.billing_status=SETTLED，结果地址 GET 返回 200、video/mp4 并收到实际字节。其余成功模型复用既有真实结果，未重复生成。

当前配置内的 18 款精确模型 ID（5 款文本、12 款视频，含 Wan 图生专用 ID、1 款音频）均有成功最小调用证据。此前返回无通道的 kling-v2-6 已从 Infistar 配置移除，不计入当前清单。MiniMax 的参考/编辑与音频时间轴仍为独立验收阻塞，基础模型接通不代表所有输入模式和完整产品流程通过。

## 接口来源

### MiniMax 参考视频能力核对与更正

2026-11-10 对照原厂与网关文档核实：

- MiniMax-H3 原生支持 reference-to-video。原厂 `POST /v2/video_generation` 使用 `content` 数组，视频项为 `type=video_url`、`role=reference_video`；支持最多 3 段视频、每段 2–15 秒、合计不超过 15 秒。参考图片、视频和音频属于参考模式，不能与首尾帧模式混用。
- Infistar 的 `/v1/videos` 公开参数表将 `input_reference` 解释为参考图片文件；其 MiniMax-H3 上线公告明确列出 2K 文生、首帧及首尾帧图生，没有在该公告中承诺视频参考。该公告不能用于断言平台绝对不支持视频参考，但现有公开资料不足以核实透传方式。
- 早先根据模型说明将视频文件放进 `input_reference`，尚未得到网关参数文档或成功结果支持。该实现只能视作未验证尝试，不能视作正确的 Ref2VA 接入；已受理后失败及退款也不能证明原厂模型不支持视频参考。
- 当前结论：原厂模型有该能力；当前 Infistar 视频参考路径未核实、未跑通。需 Infistar 提供其支持的参考视频端点、请求示例或透传规则，再验证同一供应商的实际链路。禁止将 Infistar Key 发往 MiniMax 原厂接口试探。

一手来源：

- [MiniMax 原厂创建视频任务文档](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)
- [MiniMax 官方模型仓库](https://github.com/MiniMax-AI/MiniMax-H3)
- [Infistar 视频参数说明](https://doc.infistar.cc/api-reference/video-generation)
- [Infistar 平台公告：MiniMax H3 正式上线](https://infistar.cc/announcements)

- [Infistar API 总览](https://doc.infistar.ai/api-overview)
- [视频生成详细手册](https://doc.infistar.cc/api-reference/视频/视频生成)：文件字段 `input_reference`，multipart/form-data。
- [音频转录详细手册](https://doc.infistar.cc/api-reference/音频/音频转录)：文件字段 `file`。
- 官方公开报价接口：`https://infistar.cc/api/pricing`。价格按分组、规格及真实结果变化，不能把最低展示价作为固定价格。
- [ADR 0051](decisions/0051-infistar-provider-and-recommendation.md) 记录供应商隔离、推荐展示、费用、保留期限及验收边界。
