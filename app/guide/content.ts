import { SUPPORT_WECHAT } from "@/lib/support-contact";

type GuideTopic = {
  title: string;
  paragraphs?: string[];
  steps?: string[];
  example?: { label: string; text: string };
};

export type GuideSection = {
  id: string;
  title: string;
  summary: string;
  outcome?: string;
  topics: GuideTopic[];
  note?: { title: string; text: string };
  link?: { href: string; label: string };
};

export const guideContent: Record<"zh" | "en", GuideSection[]> = {
  zh: [
    {
      id: "start", title: "第一次使用，从这里开始",
      summary: "Prompt Lens 帮你把参考视频变成详细的镜头提示词。你可以直接拿去生成相似画面，也可以先改写人物、场景和故事，再做成自己的视频。",
      topics: [
        { title: "先跑通一个镜头", steps: [
          "登录账号，进入工作台，选择「视频分析」。先准备一段 10 秒以内、主体清楚的完整镜头，或一张参考图片。",
          "上传素材，选择结果语言，点击「分析视频」或「分析图片」，等待提示词生成。",
          "对照原素材检查提示词。满意后复制到你常用的生成工具，或点击「做同款」进入视频生成。",
          "想换个创意时，在改写区域说明要保留什么、替换什么，再对照原版和改写版。",
        ] },
        { title: "选择适合你的使用方式", paragraphs: [
          "先体验效果：符合条件的新账号可使用两次免费分析，视频限定 10 秒以内的单个完整镜头。免费分析不包含视频生成。",
          "用平台积分：购买套餐后，按页面支持的范围使用自动拆镜、视频分析和已开放的积分生成组合；付费任务开始前会显示报价。",
          "用自己的 KIE Key：在设置中保存 Key，模型调用费用由你的 KIE 账户承担。你仍然可以购买套餐，用平台积分支付自动拆镜，并使用套餐包含的链接导入、改写额度。",
        ] },
      ],
      note: { title: "本期可用功能", text: "视频分析与视频生成已提供入口。音频分析、视频剪辑标为「待开放」，暂时无法进入；生成的单个镜头需要拼接成片时，可下载后使用自己的剪辑工具。" },
      link: { href: "/samples", label: "先看分析样例" },
    },
    {
      id: "import", title: "导入参考视频",
      summary: "本地文件和公开视频链接都可以作为参考。先确认素材能正常播放，再选择导入方式。",
      topics: [
        { title: "方式一：上传文件", steps: [
          "进入「视频分析」，选择「上传文件」，点击上传区域选择视频或图片。首次体验建议使用 MP4 短片。",
          "确认预览中的素材正确；需要替换时点击「更换文件」。免费体验使用 10 秒以内的完整镜头。",
          "选择「结果语言」，再开始分析。界面语言和结果语言是两个设置：使用中文界面，也可以生成英文提示词。",
        ] },
        { title: "方式二：粘贴链接", steps: [
          "在原平台打开具体视频，复制地址栏里的视频网址，或使用分享按钮复制分享文本。当前支持抖音、TikTok 和 B站。",
          "切换到「粘贴链接」，粘贴一个视频的链接或整段分享文本。不要同时放多个视频地址，也不要使用作者主页或搜索列表代替具体视频。",
          "检查下方剩余导入次数，点击「导入视频 · 成功计次」。系统先导入素材，再进入分析流程。",
        ], example: { label: "两种粘贴格式都可以", text: "直接粘贴网址：\nhttps://www.bilibili.com/video/BV11mFLziEyP/\n\n粘贴完整分享文本：\n【牌子】当世界过分“诚实”，我们要如何保持好奇与勇气 https://www.bilibili.com/video/BV11mFLziEyP/" } },
        { title: "导入前检查这三件事", paragraphs: [
          "视频是否公开且仍然存在：私密、已删除、需要额外权限或受地区限制的内容可能无法导入。分享链接不会把你在原平台的登录状态一并带过来。",
          "素材是否在当前限制内：付费分析流程目前支持最多 60 秒、100MB、20 个镜头。超出时先在外部截取需要的部分，再上传。",
          "是否还有链接导入次数：只有链接解析并保存成功才计一次，失败释放暂占次数；本地上传不消耗链接导入次数。导入成功后继续分析，会另行计算分析费用。",
        ] },
      ],
      outcome: "素材成功进入项目，可以继续选择镜头并分析。",
      link: { href: "/dashboard?tab=analyze", label: "前往视频分析" },
    },
    {
      id: "breakdown", title: "自动拆镜与分析",
      summary: "拆镜负责把整条视频分成独立镜头，分析负责把每个镜头的画面和运动转成可用的提示词。",
      topics: [
        { title: "遇到「确认分析费用」时怎么选", steps: [
          "选择「费用来源」：使用平台积分，或使用自己的 KIE Key。自带 Key 时，自动拆镜仍使用平台积分。",
          "选择分析模型。多镜头素材保留「自动拆镜」；若只处理一个完整镜头，可根据需要关闭。",
          "点击「读取视频信息」，查看总时长以及每个镜头的起止时间。勾选这次真正需要分析的镜头。",
          "点击「获取报价」，核对总积分和「拆镜 + 分析」的明细。想修改选择时点击「调整选择」。",
          "确认无误后点击「确认并开始」。此时额度先预留，任务结束后按成功结果结算。",
        ] },
        { title: "怎么理解拆镜费和分析费", paragraphs: [
          "拆镜按实际处理的视频时长计费，每开始 6 秒计 1 积分：30 秒为 5 积分，60 秒为 10 积分。这只是拆镜费用。",
          "使用平台分析时，分析部分还与所选模型、镜头数量和时长有关，以当前报价为准。只选部分镜头可以减少分析量，但不会把整条素材已经需要的拆镜工作变成免费。",
          "自带 Key 时，报价中的平台积分用于拆镜；模型费用由 KIE 账户承担。平台余额和 KIE 余额互不通用。",
        ] },
        { title: "等待处理与再次打开", paragraphs: [
          "处理过程中查看进度，不要连续重复点击提交。任务完成后，在右侧查看整片解读和镜头结果。",
          "之后可在左侧「我的项目」打开已有项目，继续查看和修改。网络中断后先检查项目或「余额与订单」中的任务记录，确认旧任务状态再决定是否重新提交。",
        ] },
      ],
      outcome: "得到按时间排列的镜头片段，以及每个镜头对应的复刻提示词。",
      note: { title: "失败与预留不是一回事", text: "确认失败的未交付部分会释放对应预留；部分成功按成功结果结算。自带 Key 的分析失败，但拆镜资产已经成功交付时，已完成的拆镜服务仍计费。结果暂时无法确认的任务可能保留预留，等待核对，不等于又扣了一次。" },
    },
    {
      id: "prompts", title: "获取与修改提示词",
      summary: "重点是拿到能交给生成模型的完整提示词。整片解读帮你把握全片，镜头提示词才是逐个生成画面的主要输入。",
      topics: [
        { title: "先看全片，再看单个镜头", steps: [
          "在「整片解读」中了解整体场景、视觉风格和节奏。内容较长时，在框内滚动阅读。",
          "找到需要复刻的镜头，核对镜头编号、起止时间，并播放片段与文字描述对照。",
          "阅读「复刻提示词」。确认主体、动作、环境、构图、光影和运镜都符合你要的画面。",
          "可以直接在提示词框中修改，修改会自动保存。使用复制按钮带走当前版本的提示词，或点击「做同款」继续生成。",
        ] },
        { title: "优先核对这些会影响成片的细节", paragraphs: [
          "人物与主体：人数、服装、姿态、朝向、出现的位置。不要让同一人物在不同镜头里变成不同描述。",
          "动作与镜头：谁在移动、往哪里移动、先做什么再做什么；镜头是固定、推进、拉远还是跟随。",
          "场景与光线：前景和背景有什么，光从哪个方向来，色调和画幅是否与原片一致。",
        ], example: { label: "把模糊要求写成具体画面", text: "不够具体：一个人在漂亮的宫殿里。\n\n更明确：一名身穿黑色西装的男子背对镜头，沿白色石栏的弧形长廊缓慢向前行走。左侧是深红色宫墙，右侧是云海。暖色晨光从画面右上方照入，镜头从人物背后平稳跟随。" } },
      ],
      note: { title: "提高相似度的方法", text: "先把一个镜头做好，再处理下一段。每次只调整一两个变量，方便判断变化来自哪里。详细提示词能减少信息遗漏，但不能保证任何生成模型都逐像素还原原视频。" },
    },
    {
      id: "rewrite", title: "用 AI 改写自己的故事",
      summary: "不必从空白开始写。以已有镜头为基础，说明哪些细节保留、哪些细节替换，让 AI 帮你整理成新的完整提示词。",
      topics: [
        { title: "一次有效改写的操作顺序", steps: [
          "找到要调整的镜头，在提示词旁的改写输入框中写下要求。",
          "选择改写结果语言。有「改写费用来源」时，选择套餐改写额度，或自己的 KIE Key。",
          "点击改写按钮，等待新的脚本版本生成。套餐模式下，一个镜头成功生成一次新版本计一次改写，不另扣平台积分；失败不计次。",
          "使用「上一版脚本 / 下一版脚本」切换比较。确认当前显示的是你想用的版本，再复制或点击「做同款」。",
        ] },
        { title: "用「保留 + 替换 + 限制」表达想法", example: { label: "可以直接参考的改写要求", text: "保留：原镜头的背后跟拍、行走节奏和暖色逆光。\n替换：把古风宫殿换成未来城市的空中步道，把黑色西装换成银灰色外套。\n限制：始终只有一个人物，不增加对白和字幕；保留右侧的开阔空间。" }, paragraphs: [
          "「更高级一点」很难让模型知道改哪里。把目标写成具体人物、场景、动作和光线，通常更容易得到可控结果。",
          "一条视频有多个镜头时，在各个镜头重复使用相同的人物特征与服装描述，有助于保持连续性。手动改文字与调用 AI 改写是不同操作，只有提交 AI 改写才会触发对应调用。",
        ] },
      ],
      outcome: "原版与改写版可以对照，当前选择的脚本可以继续送入生成。",
    },
    {
      id: "generate", title: "生成与下载视频",
      summary: "从镜头的「做同款」进入，或直接打开视频生成写入提示词。生成是一次新的模型调用，与前面的分析分别计费。",
      topics: [
        { title: "先确认费用来源", paragraphs: [
          "使用自己的 KIE Key：打开设置，填写并保存 Key，确认你的 KIE 账户有余额。保存成功后回到视频生成，模型费用由该账户承担，不消耗平台推理积分。",
          "如果页面显示「平台积分」选项，可以选择已开放的付费模型与参数组合，先获取报价，再确认生成。界面有某个模型，不代表它的每一种参数都已支持平台积分付款。",
          "免费分析次数不用于生成视频。没有自己的有效 Key，也没有可用的积分生成条件时，需要先补齐再提交。",
        ] },
        { title: "从提示词到一条成片", steps: [
          "点击「做同款」后，确认带入的提示词是当前想使用的版本；也可以直接在视频生成页面填写提示词。",
          "选择模型，再检查它支持的参考素材。只输入文字是文生视频；需要参考图或参考视频时，按当前模型要求上传，并检查预览。",
          "选择画面比例、时长、画质和生成数量。尽量让比例与参考素材一致；不是所有模型都支持相同的参数组合。",
          "平台积分模式先核对报价，再点击「确认并生成」；自带 Key 模式确认模型和参数后提交。第一次先生成一条，满意后再扩展。",
          "等待任务完成，播放结果，对照原镜头检查人物、动作、运镜和光影。使用结果中的下载入口保存视频。",
        ] },
        { title: "效果不理想时怎么调整", paragraphs: [
          "人物或构图偏差较大：先检查参考图是否合适，再补充人物位置、朝向和景别。",
          "动作太多或顺序混乱：缩短提示词中的动作链，只保留这个镜头内真正发生的变化。",
          "风格接近但镜头运动不对：明确写出移动方向、速度和是否跟随主体。不要同时要求固定镜头和大幅运镜。",
          "生成多个独立镜头后，先下载保存，再到外部剪辑工具中拼接。当前「视频剪辑」入口尚未开放。",
        ] },
      ],
      link: { href: "/dashboard?tab=settings", label: "前往设置配置 Key" },
    },
    {
      id: "credits", title: "积分、次数与订单",
      summary: "平台积分、链接导入次数、改写次数和 KIE 余额各有用途。判断一笔费用时，先看这次任务选择了哪一种费用来源。",
      topics: [
        { title: "四种额度分别用在哪里", paragraphs: [
          "平台积分：用于自动拆镜，以及页面已开放的积分分析、生成服务。分析和生成页面右上角显示余额，点击可以查看「余额与订单」。",
          "链接导入次数：粘贴视频链接并成功导入时使用。只扣导入次数，不额外扣解析积分；之后的拆镜和分析另算。",
          "套餐改写次数：使用套餐模式生成一个镜头的新脚本版本时计次，不另扣积分。选择自己的 Key 改写时，费用改由 KIE 账户承担。",
          "KIE 余额：由你在服务商账户中管理。向 Prompt Lens 购买套餐不会给 KIE 充值，在 KIE 充值也不会增加 Prompt Lens 积分。",
        ] },
        { title: "购买后怎么确认到账", steps: [
          "在套餐页选择套餐，核对金额和包含的额度，再打开支付宝付款。",
          "付款后等待订单确认，到「余额与订单」查看购买记录和可用余额。付款页面关闭不代表订单失败。",
          "如果支付宝已扣款但页面仍待确认，使用订单查询或刷新，保留订单号，先不要重复付款。",
        ] },
        { title: "为什么可用积分先减少了", paragraphs: [
          "付费任务确认后，预计费用会先从可用余额转为「任务预留积分」，以保证任务有足够额度。完成后再结算实际费用，不是预留一次、结束后再重复扣一次。",
          "例如任务报价 20 积分，确认后先预留 20；若最终成功部分结算 12，则释放剩余 8。这个数字只是帮助理解的示例，实际费用看任务记录。",
          "结果待核对时，预留可能暂时保留。到「任务消费」查看状态，或提供任务编号联系客服。",
        ] },
      ],
      link: { href: "/billing", label: "查看余额与订单" },
    },
    {
      id: "help", title: "常见问题与退款",
      summary: "先根据当前卡住的步骤排查。反馈问题时附上项目、任务或订单编号，能更快定位。",
      topics: [
        { title: "链接无法导入", paragraphs: ["先在原平台确认视频仍可访问，再复制具体视频的分享链接，每次只粘贴一个。确认剩余导入次数，以及时长和大小是否符合限制。仍失败时，可以把你已有的本地文件上传；这一步不消耗链接导入次数。"] },
        { title: "提示 Key 无效或余额不足", paragraphs: ["先确认本次选择的是平台积分还是自己的 Key。平台积分不足，到套餐页充值；KIE 余额不足，到 KIE 账户处理。Key 无效时，在设置中重新保存有效的 Key，再检查账户权限和余额。不要把 Key 当作提示词粘贴。"] },
        { title: "任务很久没有变化，或刷新后看不到结果", paragraphs: ["先从「我的项目」重新打开项目，付费任务也可以从「余额与订单」查看任务状态。页面暂时无法查询，不一定表示后台任务失败。先保留任务编号并联系客服核对，避免重复提交造成多次调用。"] },
        { title: "为什么不是完全一样的视频", paragraphs: ["分析提取的是可见细节和镜头描述，生成模型仍会重新创作画面。先核对提示词和参考素材，固定模型、比例与时长，每次修改少量细节比较结果。复刻不等于逐帧复制。"] },
        { title: "不想付款了，怎么取消", paragraphs: ["未付款订单可以主动点击「取消本次付款」。15 分钟内未完成支付的订单会进入超时关闭处理；如果已经付款，系统会先核对到账。已经付过款时不要继续扫描旧码，也不要靠再次下单来解决到账延迟。"] },
        { title: "如何申请退款", steps: [
          "打开「余额与订单」，找到已付款的购买记录，点击「申请退款」。",
          "填写退款原因以及联系邮箱或微信号，提交申请。已有使用或处理中任务的订单，请直接联系客服核对。",
          `添加客服微信 ${SUPPORT_WECHAT}，发送订单号并说明情况。提交表单后仍需客服审核同意，才会办理退款。`,
          "审核期间，对应套餐权益暂停使用；申请未通过会恢复。退款处理后，同时查看网站状态和支付宝退款记录。",
        ] },
      ],
      note: { title: "联系客服时准备什么", text: `客服微信：${SUPPORT_WECHAT}。请提供出错步骤、页面报错、发生时间，以及任务或订单编号。截图前遮住 API Key、密码等信息，客服不需要你的完整密钥。` },
      link: { href: "/billing", label: "订单与退款申请" },
    },
  ],
  en: [
    {
      id: "start", title: "Your first workflow",
      summary: "Turn a reference video into detailed shot prompts. Recreate a scene, or change its characters and setting before generating your own version.",
      topics: [
        { title: "Start with one shot", steps: [
          "Sign in, open the workspace, and choose Video analysis. Prepare one clear, continuous shot under 10 seconds, or a reference image.",
          "Upload the file, choose the result language, and start analysis. Wait for the shot prompt to appear.",
          "Compare the prompt with the reference. Copy it to your preferred generator, or use the shot's recreation action to open video generation.",
          "To try a new idea, describe what to keep and what to change in the rewrite field, then compare versions.",
        ] },
        { title: "Choose how to pay for your workflow", paragraphs: [
          "Try analysis first: eligible new accounts receive two free analyses. Trial videos must be one complete shot, up to 10 seconds. The analysis trial does not include video generation.",
          "Use platform credits: buy a package for automatic shot splitting and the supported analysis and generation options. Paid tasks show a quote before you confirm.",
          "Bring your own KIE key: save it in Settings to pay model fees from your KIE account. You can still buy a package for shot splitting, included link imports, and rewrites.",
        ] },
      ],
      note: { title: "Available now", text: "Video analysis and video generation are available. Audio analysis and video editing are marked Coming soon. Download individual generated shots and assemble them in your own editor." },
      link: { href: "/samples", label: "Explore sample analyses" },
    },
    {
      id: "import", title: "Import a reference video",
      summary: "Use a local file or a public video link. Check that your reference plays correctly before importing it.",
      topics: [
        { title: "Upload a file", steps: [
          "Open Video analysis and choose Upload file. Select a video or image; a short MP4 is a useful first test.",
          "Check the preview. Use Replace file to change the reference. For the trial, choose one continuous shot up to 10 seconds.",
          "Choose the result language and start analysis. This is separate from the interface language: you can use a Chinese interface and request English prompts.",
        ] },
        { title: "Paste a video link", steps: [
          "Open the specific video on Douyin, TikTok, or Bilibili. Copy its URL or the text supplied by the platform's Share action.",
          "Switch to the link input and paste one URL or one share message. Use a specific video, not a creator profile or a search results page.",
          "Check your remaining imports and choose Import video. The source is imported before analysis begins.",
        ], example: { label: "Both formats work", text: "Video URL:\nhttps://www.bilibili.com/video/BV11mFLziEyP/\n\nShare message:\nMy reference video https://www.bilibili.com/video/BV11mFLziEyP/" } },
        { title: "Check access, limits, and allowance", paragraphs: [
          "The video must still exist and be accessible. Private, deleted, region-restricted, or permission-protected videos may fail to import. A share link does not carry your login session from the original platform.",
          "The paid analysis workflow currently supports up to 60 seconds, 100MB, and 20 shots. Trim a longer reference in your own editor before uploading it.",
          "Only an import that is parsed and saved successfully consumes an included import. Failed imports release the reserved slot. Local uploads use no link imports. Analysis after a successful import is billed separately.",
        ] },
      ],
      outcome: "Your reference is in a project, ready for shot selection and analysis.",
      link: { href: "/dashboard?tab=analyze", label: "Open video analysis" },
    },
    {
      id: "breakdown", title: "Detect shots and analyze",
      summary: "Shot splitting divides a video into individual clips. Analysis turns each clip's visible details and movement into a generation prompt.",
      topics: [
        { title: "Work through the analysis quote", steps: [
          "Choose Payment source: Platform credits or My KIE key. Automatic splitting still uses platform credits when you bring your own key.",
          "Select an analysis model. Keep Automatic shot splitting enabled for a multi-shot reference; disable it when appropriate for a single complete shot.",
          "Select Inspect video. Review the duration and shot timestamps, then select the shots you need.",
          "Select Get quote and check the total and the splitting and analysis amounts. Use Adjust selection to revise the choices.",
          "Choose Confirm and start. Credits are reserved first, then settled against successful results.",
        ] },
        { title: "Understand the two parts of the quote", paragraphs: [
          "Splitting costs one credit per started six seconds of processed video: five credits for 30 seconds and ten for 60. This covers splitting only.",
          "Platform analysis also depends on the model and the number and duration of selected shots. Use the displayed quote. Selecting fewer shots reduces analysis work; it does not remove the work needed to split the full source.",
          "With your own key, the platform quote covers splitting and your KIE account pays the model fees. The two balances are separate.",
        ] },
        { title: "Follow progress and return to a project", paragraphs: [
          "Watch the progress instead of repeatedly submitting. When analysis finishes, the result area shows the video interpretation and individual shots.",
          "Reopen a saved project from My projects to continue. After a network interruption, check the project or the task record in Balance and orders before starting another task.",
        ] },
      ],
      outcome: "Timestamped shots and detailed recreation prompts are ready to review.",
      note: { title: "Reserved does not mean charged twice", text: "Confirmed failed work releases its reservation; partially successful tasks settle for delivered results. If splitting was delivered but your own-key analysis failed, the completed splitting service is still charged. An uncertain task can remain reserved until its outcome is checked." },
    },
    {
      id: "prompts", title: "Get and refine prompts",
      summary: "The whole-video interpretation gives context. Each shot's recreation prompt is the main input to use for generation.",
      topics: [
        { title: "Review the story, then the shot", steps: [
          "Read the whole-video interpretation for setting, visual style, and pacing. Scroll inside its panel for longer text.",
          "Find the shot you want, check its number and timestamps, and play the clip alongside its description.",
          "Review the recreation prompt for subject, action, setting, composition, lighting, and camera movement.",
          "Edit details in the prompt field; changes save automatically. Copy the current prompt or use the recreation action to continue to generation.",
        ] },
        { title: "Check the details that shape the result", paragraphs: [
          "Subject: number of people, clothing, pose, facing direction, and position in the frame. Keep character descriptions consistent across shots.",
          "Action and camera: who moves, in which direction, and in what order; whether the camera is static, pushing in, pulling back, or following.",
          "Setting and light: foreground, background, light direction, color, and framing.",
        ], example: { label: "Replace a vague idea with a visible scene", text: "Vague: A person in a beautiful palace.\n\nSpecific: A man in a black suit walks away from the camera along a curved corridor with white stone railings. A dark red palace wall stands on the left; a sea of clouds opens to the right. Warm morning light enters from the upper right as the camera follows steadily behind him." } },
      ],
      note: { title: "Improve similarity one variable at a time", text: "Start with one shot and change only one or two details per attempt. Detailed prompts reduce missing information, but cannot guarantee a pixel-for-pixel recreation by a generative model." },
    },
    {
      id: "rewrite", title: "Rewrite your own story",
      summary: "Build on an existing shot. Tell the AI what to preserve and what to replace, and get a new, complete prompt.",
      topics: [
        { title: "Create and compare a rewrite", steps: [
          "Find a shot and enter your requested changes in the rewrite field next to its prompt.",
          "Choose the output language. Where payment options are available, select Included rewrites or Own KIE key.",
          "Run the rewrite and wait for the new script version. One successful new version of one shot consumes one included rewrite, with no extra platform credits. Failed rewrites do not count.",
          "Use Previous version and Next version to compare. Select the version you want before copying it or sending it to generation.",
        ] },
        { title: "Describe what to keep, change, and avoid", example: { label: "A practical rewrite request", text: "Keep: the rear tracking shot, walking pace, and warm backlight.\nChange: replace the palace with an elevated walkway in a futuristic city, and the black suit with a silver-gray jacket.\nConstraints: keep one character, add no dialogue or captions, and preserve the open space on the right." }, paragraphs: [
          "Make it more cinematic leaves many choices unclear. Specify the character, location, action, or lighting you want to change.",
          "Repeat the same character and clothing details across related shots. Editing text by hand and asking the AI to rewrite are different actions; only submitting a rewrite starts the model call.",
        ] },
      ],
      outcome: "Compare original and rewritten versions, then generate from the selected script.",
    },
    {
      id: "generate", title: "Generate and download",
      summary: "Continue from a shot's recreation action, or write a prompt directly in Video generation. Generation is a new model call, billed separately from analysis.",
      topics: [
        { title: "Check your payment source first", paragraphs: [
          "For your own KIE key, open Settings, enter and save the key, and check your KIE balance. Return to generation after saving. Model calls use that account rather than platform inference credits.",
          "If Platform credits is available, select a supported paid model and parameter combination, get a quote, and confirm it. A model appearing in the selector does not mean every configuration supports platform billing.",
          "Free analysis attempts cannot be used for video generation. You need a valid funded key or an eligible platform-credit generation option before submitting.",
        ] },
        { title: "Generate your first clip", steps: [
          "Check that the prompt brought over from analysis is the version you want, or enter a prompt directly.",
          "Select a model and inspect its reference requirements. Text alone uses text-to-video; upload and preview reference images or videos when supported and needed.",
          "Choose the aspect ratio, duration, quality, and output count. Match the reference's ratio where possible. Supported settings vary by model.",
          "For platform credits, review the quote and choose Confirm and generate. With your own key, check your model and settings before submitting. Start with one output.",
          "Wait for completion, play the result, and compare its subject, action, camera, and lighting with the reference. Use the download action to save the video.",
        ] },
        { title: "Refine an unsatisfying result", paragraphs: [
          "If the subject or composition is wrong, check the reference image and describe position, facing direction, and shot size more precisely.",
          "If actions are confused, shorten the action sequence to what happens within this one shot.",
          "If the style is close but the camera is wrong, specify movement direction, speed, and whether it follows the subject. Avoid contradictory camera instructions.",
          "Download individual clips and assemble them in an external editor. The standalone Video editing feature is not yet open.",
        ] },
      ],
      link: { href: "/dashboard?tab=settings", label: "Configure your key in settings" },
    },
    {
      id: "credits", title: "Credits, allowances, and orders",
      summary: "Platform credits, link imports, included rewrites, and your KIE balance serve different purposes. Check the payment source to understand each charge.",
      topics: [
        { title: "What each balance pays for", paragraphs: [
          "Platform credits cover automatic splitting and supported platform analysis and generation. The top-right balance on the analysis and generation pages links to Balance and orders.",
          "Link imports are used when a pasted video link is imported successfully. The import itself consumes no extra credits; subsequent splitting and analysis are separate.",
          "Included rewrites pay for successful new shot-script versions without extra credits. Selecting your own key instead bills the model call to KIE.",
          "Your KIE balance is managed with the provider. Buying a Prompt Lens package does not top up KIE, and adding funds to KIE does not add Prompt Lens credits.",
        ] },
        { title: "Confirm a purchase", steps: [
          "Choose a package and check its price and allowances before opening Alipay payment.",
          "After payment, wait for confirmation and check the purchase record and balance in Balance and orders. Closing the payment window does not make an order fail.",
          "If Alipay has charged you but confirmation is pending, refresh or query the order, keep the order ID, and avoid paying again.",
        ] },
        { title: "Why available credits decrease before completion", paragraphs: [
          "A confirmed paid task moves its estimated cost from available credits to Reserved credits. The actual cost is settled when the outcome is known; reservation and settlement are not two separate charges.",
          "For example, a 20-credit quote reserves 20. If successful work settles for 12, the remaining eight are released. These are illustrative numbers; consult your task record for actual costs.",
          "An uncertain result may keep credits reserved while it is checked. Look under Task usage or contact support with the task ID.",
        ] },
      ],
      link: { href: "/billing", label: "View balance and orders" },
    },
    {
      id: "help", title: "Troubleshooting and refunds",
      summary: "Start with the step that failed. Include a project, task, or order ID when asking for help.",
      topics: [
        { title: "A link will not import", paragraphs: ["Check that the original video is accessible, copy its specific share link, and paste only one video at a time. Check your remaining imports and the file limits. If it still fails, upload a local copy you already have; local uploads do not use link imports."] },
        { title: "Invalid key or insufficient balance", paragraphs: ["Check whether the task uses platform credits or your KIE key. Top up the corresponding account. For an invalid key, save a valid replacement in Settings and check its permissions and provider balance. Never paste a key into a prompt."] },
        { title: "Progress is stuck or results disappeared after refresh", paragraphs: ["Reopen the reference in My projects. Paid tasks are also listed in Balance and orders. A temporary status-query error does not necessarily mean the underlying task failed. Keep the task ID and ask support to check before submitting another request."] },
        { title: "The result does not exactly match the reference", paragraphs: ["Analysis describes visible details; generation creates a new image sequence. Review the prompt and reference, keep the model, ratio, and duration fixed, and compare small changes. Recreation is not frame-by-frame copying."] },
        { title: "Cancel an unpaid order", paragraphs: ["Use Cancel this payment for an unpaid order. Orders unpaid after 15 minutes enter timeout closure; completed payments are checked before closure. If you already paid, do not scan an old code or create another purchase to resolve a confirmation delay."] },
        { title: "Request a refund", steps: [
          "Open Balance and orders, locate the paid purchase, and select Request refund.",
          "Enter a reason and contact email or WeChat ID, then submit. Contact support directly for packages with usage or pending tasks.",
          `Add WeChat support at ${SUPPORT_WECHAT} and provide the order ID and reason. Submitting the form does not issue a refund; support approval is required.`,
          "Benefits for the package are paused during review and restored if the request is declined. After processing, check both the site status and Alipay refund record.",
        ] },
      ],
      note: { title: "What to send support", text: `WeChat: ${SUPPORT_WECHAT}. Include the failing step, error message, time, and task or order ID. Hide API keys and passwords in screenshots. Support does not need your full key.` },
      link: { href: "/billing", label: "Orders and refund requests" },
    },
  ],
};
