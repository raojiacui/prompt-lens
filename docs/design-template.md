# Prompt Lens 页面设计模板

这份文档记录今天沉淀下来的页面布局、视觉风格和交互细节，后续项目如果要做类似 AI 工具、创作工具、媒体处理工具，可以直接复用这一套设计方向。

## 设计定位

整体目标不是照抄 Gamma，而是学习它的产品结构和交互清晰度：先用一个简洁的功能选择页降低用户决策成本，再进入一个聚焦的创作/处理页面。视觉上保持 Prompt Lens 自己的米黄色、陶土色、暖纸感风格，避免蓝紫渐变、强 SaaS 冷色、厚重 3D 或黏土质感。

关键词：米黄色背景、暖白卡片、浅灰半透明输入框、陶土橙强调色、轻边框、细线图标、留白、轻阴影、功能聚焦。

## 入口选择页

入口页用于登录或跳过登录后的第一个工作台界面。

布局规则：

- 页面第一屏直接展示功能选择，不做营销落地页
- 顶部左上角放轻量浮动导航：`Home / History / Settings`
- 不使用整条白色导航栏
- 不在入口页顶部放巨大品牌 logo 或品牌文字
- 标题居中：`Create with AI`
- 副标题居中：`How would you like to get started?`
- 功能卡片一行四个，移动端自然换行
- 删除类似 `Or try something new` 的装饰分割线，避免页面变重

功能卡规则：

- 卡片用暖白背景，不用纯白强对比
- 图片区域使用统一比例，当前采用 `aspect-[5/3]`
- 四张功能图必须风格一致，不能混用不同视觉语言
- 图片使用米黄、陶土、灰橄榄、柔和线条插画风
- 卡片不要出现 `LAST USED` 这种只属于某一张卡的徽标，避免高度和视觉重心不一致
- 卡片本身应该是真实链接或具备明确导航反馈，避免点击后用户觉得没有反应

推荐功能卡字段：

```ts
type FeatureCard = {
  key: "analyze" | "video-gen" | "audio" | "edit";
  title: string;
  description: string;
  icon: ElementType;
  image: string;
};
```

## 功能内页

点击任一功能卡后进入功能内页。功能内页要从后台工具感，转为创作工具感。

顶部结构：

- 左上角固定一个小巧 `Back` 按钮
- `Back` 不放在中间内容容器里，否则会视觉偏中
- `Back` 尺寸要克制，避免像主按钮
- 中间显示欢迎语：`Welcome, {displayName}!`
- `displayName` 只来自当前登录用户信息
- 未登录或本地调试时用中性兜底，比如 `creator`
- 绝对不要把开发者自己的名字写死到线上页面
- 欢迎语下面显示主问题：`What would you like to create today?`
- 主问题不要太粗，使用 `font-medium` 或接近的字重
- 主问题颜色使用柔和灰色，例如 `#5F5F5B`，不要纯黑

用户名兜底规则：

```ts
const displayName =
  session?.user?.name ||
  session?.user?.email?.split("@")[0] ||
  "creator";
```

Back 按钮建议：

```tsx
<button className="fixed left-6 top-5 z-50 inline-flex items-center gap-2 rounded-full border border-[#BFDFFF] bg-white/70 px-3.5 py-2 text-sm font-semibold text-[#0A2E63] shadow-sm hover:bg-white md:left-8">
  <ArrowLeft className="h-4 w-4" />
  Back
</button>
```

## 主输入框模板

主输入框是功能内页的核心，不要拆成很多后台表单卡片。

视觉规则：

- 输入框居中，最大宽度约 `max-w-5xl`
- 背景使用浅灰半透明，不用厚重纯白
- 推荐：`bg-[#F8F8F7]/70`
- 边框要轻：`border-[#D8D5CC]/80`
- 加轻微 `backdrop-blur-sm`
- 阴影要柔和，避免强卡片感
- 默认高度不要太高，当前推荐 `min-h-[96px]`
- 文本多时自然向下扩展，最高限制约 `260px`
- 底部控件在输入框内部，不单独做一整排外部表单

Textarea 自动增长：

```ts
const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  setPrompt(e.target.value);
  e.currentTarget.style.height = "auto";
  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 260)}px`;
};
```

Textarea 建议样式：

```tsx
<Textarea
  value={prompt}
  onChange={handlePromptChange}
  placeholder="I want to create a video about..."
  className="min-h-[96px] resize-none overflow-hidden border-0 bg-transparent px-6 py-5 pb-16 text-xl text-[#141413] shadow-none outline-none placeholder:text-[#AAA9A6] focus-visible:ring-0"
/>
```

## 附件上传与预览

附件上传参考 ChatGPT 的体验：附件属于输入框整体的一部分，但不要因为预览图单独加一整条横栏导致输入框笨重。

规则：

- 附件入口放在输入框左下角，用回形针图标
- 上传后缩略图显示在输入框内部上方
- 预览图不要加独立分隔线
- 预览图不要放到输入框外面，否则关系感变弱
- 缩略图使用小卡片，右上角有删除按钮
- 默认最多 6 张，除非业务另有要求

当前限制：

```ts
const MAX_REF_IMAGES = 6;
```

预览图建议样式：

```tsx
{referenceImagePreviews.length > 0 && (
  <div className="flex flex-wrap gap-3 px-5 pt-4">
    {referenceImagePreviews.map((preview, index) => (
      <div key={index} className="relative group h-24 w-24 overflow-hidden rounded-xl border border-[#D8D5CC] bg-white shadow-sm">
        <img src={preview} alt="" className="h-full w-full object-cover" />
        <button className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[#141413] shadow-sm hover:bg-[#D97757] hover:text-white">
          ×
        </button>
      </div>
    ))}
  </div>
)}
```

## 输入框底部控件

底部控件应该像 Gamma/ChatGPT 风格的轻胶囊，放在输入框底部。

规则：

- 附件按钮在最左侧
- 关键参数用下拉胶囊
- 提交按钮在最右侧
- 提交按钮里的纸飞机箭头应指向右上角
- 控件背景使用半透明白，例如 `bg-white/72`
- 控件边框使用浅灰，例如 `border-[#D8D5CC]/70`

视频生成页当前参数：

- Duration: `5s / 10s / 15s`
- Ratio: `16:9 / 9:16 / 1:1 / 3:4 / 4:3`
- Resolution: `720p / 1080p`

比例选项必须至少支持：

```tsx
<option value="16:9">16:9</option>
<option value="9:16">9:16</option>
<option value="1:1">1:1</option>
<option value="3:4">3:4</option>
<option value="4:3">4:3</option>
```

发送按钮图标：

```tsx
<svg className="h-6 w-6 -rotate-45" ...>
  ...
</svg>
```

## 结果区域

生成结果不应该抢首屏。

规则：

- 用户输入前只显示核心输入区
- 生成完成后，视频或结果出现在输入框下方
- 状态提示放在输入框和结果之间
- 最近记录放在更下方，弱化处理

结构顺序：

1. Welcome 区域
2. 主问题标题
3. 输入框
4. 状态提示
5. 生成结果
6. 最近记录


## 页面映射

这套模板目前对应 Prompt Lens 今天改过的几个页面和状态：

- 登录后的功能选择页：用户进入工作台后先选择能力，而不是直接进入复杂表单
- 视频分析页：进入后保留同一套 `Welcome + 主问题 + 输入框` 的创作结构
- 视频生成页：以主输入框为核心，附件、时长、比例、清晰度都收进输入框底部
- 音频分析页：同样使用主输入框结构，核心差异只放在上传类型和参数项上
- 视频剪辑页：同样使用主输入框结构，生成或剪辑结果出现在输入框下方

复用原则：不同功能页不要重新设计一套页面骨架，只替换标题、placeholder、参数下拉项、结果区类型。这样用户从一个功能切到另一个功能时，不需要重新学习界面。

## 反复校准过的细节

这些是今天调 UI 时反复确认过的细节，后续项目应直接沿用：

- 不照抄 Gamma 的蓝色渐变，参考它的信息结构和交互层级即可
- Prompt Lens 的主视觉应继续走米黄色、暖纸感、陶土橙、浅灰线条方向
- 功能入口页不要出现整条白色导航栏，顶部导航应浮在背景上
- `Prompt Lens` 品牌和图标不放在功能选择页顶部，避免视觉重心被拉走
- `Home / History / Settings` 要保留小图标，但整体靠左，不要挤在右上角
- `How would you like to get started?` 应该是轻一点的灰色，不要过深
- `What would you like to create today?` 不要使用超粗黑体，使用中等字重和柔和灰色
- `Back` 要在左上角，而且是小巧胶囊，不是大号主按钮
- 附件预览应该在输入框里面，不在输入框上方，也不要为它单独加一条厚重区域
- 输入框默认高度要克制，文本变多时自然向下扩展
- 发送按钮纸飞机箭头指向右上角
- 线上用户名必须来自登录 session，本地调试未登录才使用中性 fallback
## 色彩模板

推荐颜色：

```txt
页面背景：#FBF7EF
入口页背景渐变：#FBF6EA -> #F3E9D8 -> #EED9C4
主文字：#141413
次级文字：#6B6860
柔和标题灰：#5F5F5B
边框：#D8D5CC
弱边框：#D8D5CC/70 或 /80
强调色：#D97757
强调 hover：#C96848
输入框浅灰：#F8F8F7/70
控件半透明白：white/72
```

避免：

- 大面积蓝紫渐变
- 强烈霓虹色
- 纯黑大标题搭配超粗字重
- 厚重白色整条 navbar
- 卡片套卡片
- 多余的装饰分割线

## 图片风格模板

功能图不是 3D、黏土、陶瓷或橡皮泥风格，而是米黄纸感 + 陶土色系 + 轻漫画线条插画。

统一方向：

```txt
温暖的 terracotta 陶土色系编辑插画，米黄色纸质背景，精致的 SaaS 产品功能封面图，轻漫画风线条插画，细腻干净的描边，柔和扁平色块，低饱和暖色调，陶土橙、暖沙色、灰橄榄色、柔和炭黑，画面高级、极简、清爽，有轻微纸张纹理和柔和阴影，不要文字，不要字母，不要 logo，不要水印，不要黏土质感，不要陶瓷质感，不要 3D，不要厚涂
```

负面方向：

```txt
黏土，陶瓷，橡皮泥，3D 渲染，厚重立体感，真实摄影，玻璃质感，金属质感，高饱和霓虹色，紫蓝渐变，暗黑背景，复杂仪表盘，乱码文字，可读文字，字母，logo，水印，过度装饰，杂乱元素
```

## 本地调试登录策略

开发阶段可以禁用登录，方便调 UI。

规则：

- 本地 `NODE_ENV === "development"` 可以绕过登录
- `/login` 可以直接跳 `/dashboard`
- `/dashboard` 不应该因为未登录跳回首页
- 生产环境保留正常登录能力
- 页面用户名不能写死开发者名字

## 实施检查清单

页面完成前检查：

- 首页是否没有白色整条导航栏
- Home/History/Settings 是否浮在背景上
- 功能卡图片是否统一比例和风格
- 功能卡是否可点击，并且 URL 有明确变化
- 功能内页 Back 是否在视口左上角
- Back 是否足够小巧
- Welcome 是否使用真实用户或中性 fallback
- 主问题标题是否不是过粗黑体
- 输入框是否浅灰半透明
- 附件预览是否在输入框内部但不形成笨重横栏
- 输入框是否默认较矮，并能随内容增长
- 下拉参数是否在输入框底部
- 比例是否支持 `16:9 / 9:16 / 1:1 / 3:4 / 4:3`
- 生成结果是否出现在输入框下方

推荐验证命令：

```bash
pnpm exec tsc --noEmit
pnpm build
```
