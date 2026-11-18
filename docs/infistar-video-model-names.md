# Infistar 视频生成模型命名核对（2026-11-18）

依据：[Infistar 官方模型与价格 / 模型广场](https://infistar.cc/pricing)，该公开页面标注数据读取时间为 **2026-11-18 05:05（北京时间）**。正式的运行时授权仍应以当前用户 Key 的模型分组及对应 API 接口为准。

## 两个容易混淆、但必须分开的系列

| Prompt-Lens 展示名称 | Infistar 视频生成 API 的准确 model ID | 内部 family |
| --- | --- | --- |
| 豆包 Seedance 2.0 | `doubao-seedance-2-0-260128` | Doubao Seedance |
| 豆包 Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` | Doubao Seedance |
| 豆包 Seedance 2.0 Mini | `doubao-seedance-2.0-mini` | Doubao Seedance |
| 即梦 视频 3.0 | `jimeng-video-3.0` | Jimeng |
| 即梦 视频 3.0 Pro | `jimeng-video-3.0-pro` | Jimeng |

**关键区别**：这些是真实不同的接口模型 ID。虽然字节旗下即梦平台也可能提供 Seedance 模型，不能因此把 Infistar 的 `doubao-seedance-*` 与 `jimeng-video-*` 合并成同一个型号或给 Seedance 添加“即梦”前缀。

## 对照同一公开模型表核对过的其他现有视频型号

| API model ID | Prompt-Lens 当前名称 |
| --- | --- |
| `kling-v3` | 可灵 Kling 3 |
| `kling-v3-omni` | 可灵 Kling 3 Omni |
| `kling-3.0-turbo` | 可灵 Kling 3 Turbo |
| `kling-video-o1` | 可灵 Kling O1 |
| `MiniMax-H3` | MiniMax H3 |
| `wan2.7-t2v` | Wan 2.7（文生视频） |
| `wan2.7-i2v` | Wan 2.7（图生视频） |

## 变更范围与边界

- 只修正用户可见的 Seedance/即梦名称、family 元数据和通用基础配置常量名称，**不改 providerModelId、不换 API、不开通新模型、不修改已验证的时长/清晰度/价格/积分参数**。
- 保留所有旧的 `infistar-...` UI 注册 ID，避免影响保存过的选择。
- 官方目录还列出 `doubao-seedance-2-5-260628` 和 `wan3.0-video` 等其他模型；本次不擅自加入，因为不同模型的实际输入参数和当前帐号可用性还需独立验证。
- 本次在 `staging/v2` 验证后再考虑合并正式分支 `prompt-lens-V2`，不会自动同步主站。
