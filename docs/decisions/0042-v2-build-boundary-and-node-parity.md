# ADR 0042：为独立 V2 正式发布准备构建边界并固定 Node 24

- 日期：2026-11-09
- 状态：构建边界及 Node 24 纠正均已验证，测试项目 Git 构建完成；正式 V2 未发布。
- 关联：ADR 0031、0041；上线记录第 011 项。

## 背景

负责人要求继续上线前配置。最初仓库 ignoreCommand 只放行测试项目，会阻止既定路线中正式项目从独立 prompt-lens-V2 构建；正式项目 Node=24.x，测试 Node=22.x。助手初次选择按测试环境固定 22，负责人随后指出既定目标为 Node 24。本记录将当前决定更正为统一 24，并保留下方首轮 22 的执行快照，避免将其误记为最终结果。

## 决策

- 将内联 ignoreCommand 替换为无依赖 Node 脚本，避免再次超过命令长度限制。仅放行明确的两个项目 ID、精确分支 prompt-lens-V2、VERCEL_ENV=production 同时满足的构建；其他项目、main/其他分支、Preview、缺失分支的手动来源均跳过。
- 正式项目当前继续跟踪 main；允许正式项目未来构建 V2 的仓库规则只是准备，不修改面板分支、GitHub 默认分支或正式域名，不触发正式 V2 发布。
- 在 V2 package.json 固定 engines.node=24.x，并将测试项目的 Node 设置从 22.x 改为 24.x，验证后续测试 Git 构建。正式项目已为 24.x，保持其设置、main 跟踪和旧部署不变，V2 正式发布时沿用 24。
- 继续通过本地验证、提交、GitHub V2 推送及测试项目 Git 自动构建验证新规则；保持测试邀请白名单及业务权限，不改运行时密钥、数据库、Worker 或商业功能。
- 不新增 CLI 上传、手动提升或任意缺失来源的发布豁免。规则依赖 Vercel 系统变量，不把构建筛选当作身份认证或完整安全边界。

## 替代方案

- 保留只允许测试项目的规则：正式切分支后会跳过构建，不满足既定发布路线。
- 允许任意项目/分支或缺失分支：扩大误部署范围，不采用。
- 继续正式 Node 24、测试 Node 22：保留可避免的环境差异，不采用。
- 将正式 V2 降到 22：与负责人确认的 24 目标不符，已撤回初次选择；统一测试到 24 后重新验证云端构建。

## 后果与验证计划

- 正式切换时无需临时再修改仓库构建规则，但仍须完成其他前置项并取得负责人正式发布授权。
- Node 主版本升级须经显式代码变更；Vercel 同主版本的补丁更新仍由平台维护。
- 运行实际子进程退出码矩阵，覆盖两项目的 V2/main/其他/空分支以及 production/preview/development/空环境、未知项目、大小写错误；同时验证命令长度与 engines 固定值。
- 本地生产构建通过后提交并推送测试，核对远端 SHA、Git 来源、测试固定域名、云端 Node 版本和正式部署 ID；仓库变更不等于正式发布验收。
- 付费任务、生产数据库写入、商户资料及正式调度均不纳入本项。

## 首轮执行证据（Node 22 选择已撤回）

- 修改前只读快照：正式 Node 24/main、测试 Node 22/V2；两项目自动暴露系统变量，build/install/rootDirectory 均默认。正式部署仍为 dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV。
- 20 项本地检查通过：18 个实际子进程退出码场景、ignoreCommand 长度/脚本指向、Node 主版本声明。两项目 V2/production 均返回 1，禁止组合均返回 0。
- 本地 Next.js 生产构建通过；本机为 Node 24.13.0，不将此称为 Node 22 运行验证。保留既有本地 OAuth 凭据、上级锁文件和 Browserslist 警告；Node 22 由随后测试项目 Git 构建核验。
- 推送前已 fetch 核对：远端 V2 为前一轮已验收的 38db29d211222c372b283326bcf310d97fff67e3，本地此前仅有一条部署证据文档提交，无未集成远端提交。已有无关文件不纳入本项。
- 提交 bda7fc0f5a81400aa44c3d13476281fb865e055e 已先本地验证/提交，再推送 GitHub prompt-lens-V2；远端 SHA 回读一致，main 保持 75eb611f8759745ec743818bce24350691d6ab8d。此前一条本地提交仅补写上一模块部署证据，一并正常推送。
- 2026-11-09 15:08（Asia/Shanghai）：测试固定域名 prompt-lens-v2-test.vercel.app 指向 dpl_7Mnebb8EXA8vy2qfitNwZEk946Ui，READY、source=git、gitSource.ref=prompt-lens-V2、SHA=bda7fc0f5a81400aa44c3d13476281fb865e055e，deployment.projectSettings.nodeVersion=22.x。正常 Git 构建通过新规则，未手动跳过 Ignored Build Step。
- 正式项目面板仍为 main、Node 24，旧 main 的源代码没有 engines 变更；正式域名仍指向 dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV。V2 源码中的 22.x 声明仅供以后正式 V2 部署采用，不将准备工作表述为正式运行环境已切换。
- 没有 Vercel 项目设置写入、CLI 上传、手动提升、正式分支/默认分支切换、数据库/Worker/付费模型操作；未提交已有无关工作区修改。新规则是构建范围准备，不能替代后续正式站业务验收。
- 具体部署证据补作本地提交，不为补写记录额外触发第二次测试构建。临时只读脚本和脱敏快照保存在忽略的 temp/。

## Node 24 纠正与验证

- 负责人明确继续使用 Node 24；本机为 24.13.0，此前同一应用代码的本地生产构建已通过。仅更正版本声明、对应断言及测试项目 Node 设置，构建保护脚本与应用业务代码不变。
- 只向测试项目写入 nodeVersion=24.x，修改前核对根 .vercel/project.json 及实际项目 ID/名称；不修改正式项目或任何环境变量。
- 本地检查通过后提交、推送 V2，依靠 Git 自动构建验证 Node 24，不手动提升或 CLI 上传。云端结果完成后追加；未提前把真实业务兼容或模型交付标记通过。
- 更正后的 20 项本地检查通过；同一应用代码已在本机 Node 24.13.0 完成生产构建，本轮仅改 engines 与对应版本断言，未重复执行没有新业务代码的全量本地构建。
- 已先本地提交 30fdf3896e5550497ab8107384c079e760a1981f，再以仅 nodeVersion=24.x 的 PATCH 更新测试项目。修改前核实根绑定及实际项目 ID/名称，回读为 24.x，测试 productionBranch 与面板 ignoreCommand 未变；正式项目无写入。
- 正常推送 V2 后远端 SHA 回读为 30fdf3896e5550497ab8107384c079e760a1981f，main 保持 75eb611f8759745ec743818bce24350691d6ab8d。
- 2026-11-09 15:18（Asia/Shanghai）：固定测试域名已指向 dpl_G1FKKGixYNggkbdvJg8MyovbZMZ7，READY、Git 来源、V2 分支及 SHA 与更正提交一致，项目设置及该部署的 Node 配置均为 24.x。
- 同次回读正式项目仍 main/24.x，正式域名仍指向 dpl_AhKmkGrgiKoL25A8KfS8jcLGcBAV。未来正式 V2 使用当前 24.x 声明，无需再降到 22。
- 新测试部署只读 HTTP 检查：/login=200、/api/auth/ok=200 且正常；匿名 /samples=307 到 /login?next=%2Fsamples，与邀请测试中间件一致，不计为已登录样例页面验收。不取消白名单、不发送验证码、不调用付费模型，不修改业务数据。
- 测试 Node 配置及代码更正已完成；本地补充部署记录，不再重复推送触发构建。

## 官方依据

- [Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings)：0 跳过，1 继续；仓库 ignoreCommand 覆盖项目面板设置。
- [Node 主版本配置](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)：支持 24.x，package.json engines 可覆盖项目面板所选版本。
