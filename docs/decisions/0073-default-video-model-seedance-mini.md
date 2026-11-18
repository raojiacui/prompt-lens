# ADR 0073：视频生成页默认选择 Seedance 2 Mini

- 日期：2026-11-18
- 状态：本地验证及获授权的主站 Git 发布完成。

## 背景

负责人要求视频生成页默认使用 Seedance 2 Mini。代码初始值已为该模型，但浏览器持久化的上次模型会在加载后覆盖初始值，导致页面显示 Wan 2.7 等旧选择。

## 决策

- 普通视频生成入口每次打开默认选择 Seedance 2 Mini，不再保存或恢复上次选择的模型；继续恢复提示词、素材和格式等已有设置。
- 用户在当前页面仍可自由切换模型。分镜等入口明确传入 initialModel 时保留指定模型。
- 切换供应商后如原模型不可用，优先选该供应商的 Mini：KIE 为 bytedance/seedance-2-mini，Infistar 为 doubao-seedance-2.0-mini。Mini 不在可用列表时沿用首个可用模型回退。

## 备选方案

- 仅改 useState 默认值：现有值已经正确，无法解决缓存覆盖，不采用。
- 清空全部浏览器设置：会丢失其他创作设置，不采用。

## 影响与验证

旧缓存中的 model 字段自然被忽略，下次设置写入时移除；不改模型能力、计费、审核或服务商配置。

修改源码 ESLint、TypeScript 和差异检查通过；既有模型路由与 Infistar 回归共 28 项通过。此记录不代表已经发布到线上。

## 获授权发布

- 负责人明确要求“推送主站吧”，本次与 ADR 0074 一起发布。额外本地生产构建通过，使用隔离数据库地址；未调用模型或改动数据库。
- GitHub prompt-lens-V2 实读 SHA 为 `95a3bd3c1145341d6e431b90fe5b97ebbd98a195`。正式部署 `dpl_3rZHPC8dgo52iVjSDxb97kRZX9q9` 为 READY、source=git，分支及 SHA 一致，正式域名 prompt-lens.cc.cd 已指向该部署。
- 测试分支仍为 4c18e50，测试域名部署仍为 dpl_8DCZWEc3NwBo1UDD2SC5nqa7hVD4。没有 CLI 上传、手动提升或修改项目配置。
- 正式首页、定价、登录页匿名 HTTP 均 200，匿名 credits/me 为 401。未使用负责人登录会话操作下拉框，登录后页面交互仍待用户确认。
