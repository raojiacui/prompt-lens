# ADR 0042：为独立 V2 正式发布准备构建边界并固定 Node 22

- 日期：2026-11-09
- 状态：仓库准备及本地/测试 Git 构建验证完成；正式项目分支切换和正式 V2 发布未执行。
- 关联：ADR 0031、0041；上线记录第 011 项。

## 背景

负责人要求继续上线前配置。当前仓库 ignoreCommand 只放行测试项目，将阻止既定路线中正式项目从独立 prompt-lens-V2 构建；测试面板也保留自己的分支过滤。正式项目 Node=24.x，测试 Node=22.x；前一轮测试 Git 构建实际使用 22.x，V2 package.json 没有 engines，后续正式构建会采用另一个主版本。

## 决策

- 将内联 ignoreCommand 替换为无依赖 Node 脚本，避免再次超过命令长度限制。仅放行明确的两个项目 ID、精确分支 prompt-lens-V2、VERCEL_ENV=production 同时满足的构建；其他项目、main/其他分支、Preview、缺失分支的手动来源均跳过。
- 正式项目当前继续跟踪 main；允许正式项目未来构建 V2 的仓库规则只是准备，不修改面板分支、GitHub 默认分支或正式域名，不触发正式 V2 发布。
- 在 V2 package.json 固定 engines.node=22.x，采用测试站已使用的 Node 主版本。依 Vercel 官方优先级，该声明供后续 V2 构建及运行采用；旧 main 源码及旧正式部署不变。本地 Node 24 的验证不冒充 Node 22 云端验证。
- 继续通过本地验证、提交、GitHub V2 推送及测试项目 Git 自动构建验证新规则；保持测试邀请白名单及业务权限，不改运行时密钥、数据库、Worker 或商业功能。
- 不新增 CLI 上传、手动提升或任意缺失来源的发布豁免。规则依赖 Vercel 系统变量，不把构建筛选当作身份认证或完整安全边界。

## 替代方案

- 保留只允许测试项目的规则：正式切分支后会跳过构建，不满足既定发布路线。
- 允许任意项目/分支或缺失分支：扩大误部署范围，不采用。
- 继续正式 Node 24、测试 Node 22：保留可避免的环境差异；本次将 V2 固定到已云端构建的 22。
- 把测试升级到 24：需要重新建立云端运行验收，本次以现有测试基线为准；Node 后续升级独立安排。

## 后果与验证计划

- 正式切换时无需临时再修改仓库构建规则，但仍须完成其他前置项并取得负责人正式发布授权。
- Node 主版本升级须经显式代码变更；Vercel 同主版本的补丁更新仍由平台维护。
- 运行实际子进程退出码矩阵，覆盖两项目的 V2/main/其他/空分支以及 production/preview/development/空环境、未知项目、大小写错误；同时验证命令长度与 engines 固定值。
- 本地生产构建通过后提交并推送测试，核对远端 SHA、Git 来源、测试固定域名、云端 Node 版本和正式部署 ID；仓库变更不等于正式发布验收。
- 付费任务、生产数据库写入、商户资料及正式调度均不纳入本项。

## 执行证据

- 修改前只读快照：正式 Node 24/main、测试 Node 22/V2；两项目自动暴露系统变量，build/install/rootDirectory 均默认。正式部署仍为 dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV。
- 20 项本地检查通过：18 个实际子进程退出码场景、ignoreCommand 长度/脚本指向、Node 主版本声明。两项目 V2/production 均返回 1，禁止组合均返回 0。
- 本地 Next.js 生产构建通过；本机为 Node 24.13.0，不将此称为 Node 22 运行验证。保留既有本地 OAuth 凭据、上级锁文件和 Browserslist 警告；Node 22 由随后测试项目 Git 构建核验。
- 推送前已 fetch 核对：远端 V2 为前一轮已验收的 38db29d211222c372b283326bcf310d97fff67e3，本地此前仅有一条部署证据文档提交，无未集成远端提交。已有无关文件不纳入本项。
- 提交 bda7fc0f5a81400aa44c3d13476281fb865e055e 已先本地验证/提交，再推送 GitHub prompt-lens-V2；远端 SHA 回读一致，main 保持 75eb611f8759745ec743818bce24350691d6ab8d。此前一条本地提交仅补写上一模块部署证据，一并正常推送。
- 2026-11-09 15:08（Asia/Shanghai）：测试固定域名 prompt-lens-v2-test.vercel.app 指向 dpl_7Mnebb8EXA8vy2qfitNwZEk946Ui，READY、source=git、gitSource.ref=prompt-lens-V2、SHA=bda7fc0f5a81400aa44c3d13476281fb865e055e，deployment.projectSettings.nodeVersion=22.x。正常 Git 构建通过新规则，未手动跳过 Ignored Build Step。
- 正式项目面板仍为 main、Node 24，旧 main 的源代码没有 engines 变更；正式域名仍指向 dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV。V2 源码中的 22.x 声明仅供以后正式 V2 部署采用，不将准备工作表述为正式运行环境已切换。
- 没有 Vercel 项目设置写入、CLI 上传、手动提升、正式分支/默认分支切换、数据库/Worker/付费模型操作；未提交已有无关工作区修改。新规则是构建范围准备，不能替代后续正式站业务验收。
- 具体部署证据补作本地提交，不为补写记录额外触发第二次测试构建。临时只读脚本和脱敏快照保存在忽略的 temp/。

## 官方依据

- [Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings)：0 跳过，1 继续；仓库 ignoreCommand 覆盖项目面板设置。
- [Node 主版本配置](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)：当前支持 22.x，package.json engines 可覆盖项目面板所选版本。
