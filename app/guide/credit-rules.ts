import { COMMERCIAL_PACKAGES, estimateGeneration, quoteAnalysis } from "@/lib/billing/pricing-v6";
import type { GuideTopic } from "./content";

function price(modelId: string, resolution: string, durationSeconds: number, audio = false, referenceVideoSeconds?: number) {
  try { return String(estimateGeneration({ modelId, resolution, durationSeconds, audio, referenceVideoSeconds }).credits); }
  catch { return "-"; }
}

export function creditRuleTopics(zh: boolean): GuideTopic[] {
  const ordinary: [string, string, string, boolean][] = [
    ["Wan 2.6", "wan/2-6-text-to-video", "720p", false],
    ["Wan 2.6", "wan/2-6-text-to-video", "1080p", false],
    ["Seedance Mini", "bytedance/seedance-2-mini", "480p", false],
    ["Seedance Mini", "bytedance/seedance-2-mini", "720p", false],
    ["Seedance Fast", "bytedance/seedance-2-fast", "720p", false],
    ["Seedance 2", "bytedance/seedance-2", "720p", false],
    ["Seedance 2", "bytedance/seedance-2", "1080p", false],
    ["Kling 2.6", "kling-2.6/text-to-video", "1080p", false],
    ["Kling 2.6", "kling-2.6/text-to-video", "1080p", true],
    ["Kling 3", "kling-3.0/video", "720p", false],
    ["Kling 3", "kling-3.0/video", "720p", true],
    ["Kling 3", "kling-3.0/video", "1080p", false],
    ["Kling 3", "kling-3.0/video", "1080p", true],
  ];
  const analysisRows = [[10, 1, false], [10, 1, true], [30, 6, true], [60, 20, true]].map(([seconds, count, split]) => {
    const sourceDurationUs = Number(seconds) * 1e6;
    const scenes = Array.from({ length: Number(count) }, (_, i) => ({ id: String(i), startUs: i * sourceDurationUs / Number(count), endUs: (i + 1) * sourceDurationUs / Number(count) }));
    const input = { payer: "platform" as const, sourceDurationUs, scenes, automaticSplit: Boolean(split), paidSplitReusable: false };
    return [String(seconds), String(count), split ? (zh ? "包含" : "Included") : (zh ? "不拆镜" : "No splitting"), String(quoteAnalysis({ ...input, model: "flash" }).credits), String(quoteAnalysis({ ...input, model: "pro" }).credits)];
  });
  const referenceModels: [string, string, string][] = [
    ["Seedance Mini", "bytedance/seedance-2-mini", "480p"],
    ["Seedance Mini", "bytedance/seedance-2-mini", "720p"],
    ["Seedance Fast", "bytedance/seedance-2-fast", "720p"],
    ["Seedance 2", "bytedance/seedance-2", "720p"],
    ["Seedance 2", "bytedance/seedance-2", "1080p"],
    ["Wan 2.6", "wan/2-6-video-to-video", "720p"],
    ["Wan 2.6", "wan/2-6-video-to-video", "1080p"],
  ];
  const editing: [string, string, string][] = [
    ["Wan 2.7", "wan/2-7-videoedit", "720p"], ["Wan 2.7", "wan/2-7-videoedit", "1080p"],
    ["Kling Omni", "kling-3.0-omni/transformation", "720p"], ["Kling Omni", "kling-3.0-omni/transformation", "1080p"],
    ["HappyHorse", "happyhorse/video-edit", "720p"], ["HappyHorse", "happyhorse/video-edit", "1080p"],
  ];
  const durationColumns = zh ? ["5 秒", "10 秒", "15 秒"] : ["5 sec", "10 sec", "15 sec"];
  return [
    { title: zh ? "套餐包含哪些额度" : "Package allowances", paragraphs: [zh ? "三个套餐的通用积分适用于同一套已开放功能，不按套餐锁定模型。表内积分均为平台积分，不是 KIE 点数。金额为人民币；每次使用仍需足够可用余额。" : "All packages use the same wallet and supported features. These are Prompt Lens credits, not KIE credits. Prices are in CNY; each task needs sufficient available credits."], table: {
      columns: zh ? ["套餐", "价格", "通用积分", "改写次数", "链接导入次数"] : ["Package", "CNY", "Credits", "Rewrites", "Link imports"],
      rows: COMMERCIAL_PACKAGES.map((p, i) => [zh ? p.name : ["Starter", "Creator", "Volume"][i], (p.priceCents / 100).toFixed(2), String(p.credits), String(p.rewrites), String(p.linkImports)]),
    } },
    { title: zh ? "拆镜和分析每次怎么扣" : "Splitting and analysis charges", paragraphs: zh ? [
      "自动拆镜：处理视频总时长每开始 6 秒扣 1 积分，向上取整。5 秒扣 1，10 秒扣 2，30 秒扣 5，60 秒扣 10。已支付且可复用的拆镜结果不重复收拆镜费。",
      "Flash 分析：所选镜头数 × 1 ＋ 向上取整（所选镜头总秒数 × 2 ÷ 5）。Pro 分析：所选镜头数 × 2 ＋ 向上取整（所选镜头总秒数 ÷ 2）。时长合计后再取整，不逐镜头重复取整。",
      "总费用＝本次需要的拆镜积分＋分析积分。手动上传完整单镜头、不启用自动拆镜时只算分析。当前付费分析最多 60 秒、20 个镜头；只分析选中镜头，但首次拆镜按整段视频计算。下表为全部所选镜头分析成功时的总积分。",
      "新账号的两次免费体验只用于符合条件的 10 秒以内单镜头分析，不适用于视频生成。试用用完后，不会自动继续使用平台 Key；需要购买额度或选择自己的 Key。",
    ] : [
      "Automatic splitting costs one credit per started six seconds of the full source: 5 sec = 1, 10 sec = 2, 30 sec = 5, 60 sec = 10. Reusable splitting that was already paid is not charged again.",
      "Flash analysis = selected shot count + ceiling(total selected seconds × 2 / 5). Pro = selected shot count × 2 + ceiling(total selected seconds / 2). Durations are summed before rounding.",
      "Total = any new splitting fee + analysis fee. A complete manually uploaded shot without splitting pays only analysis. Paid analysis currently supports up to 60 seconds and 20 shots. Analysis covers selected shots; initial splitting covers the full source. Examples assume all selected shots succeed.",
      "Two introductory trials apply only to eligible single-shot analysis within 10 seconds, not generation. After trials, purchase credits or explicitly use your own key; the platform key is not an automatic fallback.",
    ], table: { columns: zh ? ["总秒数", "镜头数", "拆镜", "Flash 总积分", "Pro 总积分"] : ["Seconds", "Shots", "Splitting", "Flash credits", "Pro credits"], rows: analysisRows } },
    { title: zh ? "文字、图片生成积分表（每条）" : "Text and image generation (per output)", paragraphs: zh ? [
      "下表每个数字都是生成一条视频的积分。Wan 文生、单图生成同配置价格相同；Seedance 文字和图片参考使用同一档价格；Kling 2.6 此处为文字生成，Kling 3 支持文字和图片。素材数量、比例等仍需符合模型限制。",
      "Wan 支持 5、10、15 秒；Seedance 支持 4–15 秒；Kling 2.6 支持 5、10 秒；Kling 3 支持 3–15 秒。表中“-”表示当前未支持该组合，不代表免费。其他支持时长的积分会显示在生成按钮与确认报价中。",
      "Kling 有声与无声价格不同，表内分别列出。当前没有音频开关的生成入口默认提交无声配置，不能把有声行当成该入口的默认费用。",
    ] : [
      "Each number is the price of one output. Wan text and single-image modes share these rates. Seedance text and image references share their tier. Kling 2.6 here is text-only; Kling 3 supports text and images. Input and aspect-ratio limits still apply.",
      "Wan supports 5/10/15 seconds; Seedance 4–15; Kling 2.6 5/10; Kling 3 3–15. A dash means unsupported, not free. Other supported durations are priced on the generation button and confirmation quote.",
      "Kling audio and silent configurations have separate prices. Generation controls without an audio switch submit silent configuration; the audio rows are not their default charge.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", zh ? "声音配置" : "Audio", ...durationColumns], rows: ordinary.map(([name, model, resolution, audio]) => [name, resolution, audio ? (zh ? "有声" : "On") : (model.startsWith("kling") ? (zh ? "无声" : "Off") : (zh ? "模型默认" : "Model default")), ...[5, 10, 15].map(s => price(model, resolution, s, audio))]) } },
    { title: zh ? "Grok 文字生成" : "Grok text generation", table: { columns: [zh ? "画质" : "Quality", zh ? "6 秒" : "6 sec", zh ? "10 秒" : "10 sec"], rows: [["720p", price("grok-imagine/text-to-video", "720p", 6), price("grok-imagine/text-to-video", "720p", 10)]] } },
    { title: zh ? "参考视频生成（输入视频为 5 秒）" : "Reference generation (5-second input)", paragraphs: zh ? [
      "Seedance 按“参考视频秒数＋输出视频秒数”计价，不是只算输出。例如 Fast 720p 输入 5 秒、输出 10 秒，扣 115 积分；同样输出 10 秒但不带参考视频，扣 125 积分。更长输入可能使总费用增加。",
      "以下仅以 5 秒输入举例，不是任何长度参考视频的固定价。后台会检测实际时长并向上取整；按钮读到的时长只是预估，确认弹窗的后台报价才是本次费用。Wan 2.6 视频参考按输出档位计价，不重复加输入时长。",
    ] : [
      "Seedance bills input plus output seconds. Fast 720p with a 5-second input and 10-second output costs 115 credits; a 10-second output without video input costs 125. Longer inputs can increase the total.",
      "These examples use exactly five seconds of input, not a flat rate for all source lengths. The server probes and rounds the duration up. Button timing is an estimate; the confirmation quote determines this task's charge. Wan 2.6 reference mode bills output tiers without adding source seconds again.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", ...durationColumns], rows: referenceModels.map(([name, model, resolution]) => [name, resolution, ...[5, 10, 15].map(s => price(model, resolution, s, false, 5))]) } },
    { title: zh ? "视频编辑（按输出时长）" : "Video editing (output duration)", paragraphs: zh ? [
      "这里的视频编辑是视频生成中的模型能力，不是尚待开放的独立“视频剪辑”工具。编辑模型不套用 Seedance 的输入加输出算法。下表按输入与输出等长、无额外音频选项列出；其他已支持配置以报价为准。",
      "Wan 2.7：2–10 秒；HappyHorse：保持原视频长度，3–60 秒；Kling Omni：受参考素材与模式限制，纯视频参考通常保持原长度，多图编辑的输出时长与素材需匹配模型要求。",
    ] : [
      "These are editing models inside video generation, not the unopened standalone Video editing tool. They do not add source seconds as Seedance does. Examples use equally long input and output without an extra audio option; review the quote for other supported configurations.",
      "Wan 2.7: 2–10 seconds. HappyHorse: original duration, 3–60 seconds. Kling Omni depends on the reference mode; video-only typically preserves source duration, while image-assisted edits must satisfy the model's output and input limits.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", ...[5, 10, 15, 30, 60].map(s => zh ? `${s} 秒` : `${s} sec`)], rows: editing.map(([name, model, resolution]) => [name, resolution, ...[5, 10, 15, 30, 60].map(s => price(model, resolution, s, false, s))]) } },
    { title: zh ? "条数、改写、导入与自己的 Key" : "Batch size, rewrites, imports, and your key", paragraphs: zh ? [
      "生成总积分＝每条报价之和。相同配置 2 条就是单条 × 2，最多一次 4 条。例如 Wan 720p/5 秒一条 40，两条 80，四条 160。换模型、改时长、改画质或重新生成，是新的任务，需要重新报价。",
      "一个镜头成功生成一个新的 AI 改写版本，消耗 1 次套餐改写额度、0 额外平台积分；失败不计次。一次处理多个镜头按成功的新版本数量计次。改写次数与通用积分不可互换。",
      "成功导入一个视频链接消耗 1 次链接导入额度、0 额外平台积分。处理中暂占次数，失败后释放；同一请求重试不重复计次。重新发起一个新的成功导入会计一次。手动上传本地文件不消耗导入次数。导入完成后的分析、拆镜另算。",
      "自带 Key 的手动分析、生成、改写不扣平台推理积分，模型费用从自己的 KIE 账户扣。自动拆镜仍扣平台积分，链接导入仍需要对应额度。“0 平台积分”不表示 KIE 免费。",
      "Sora 和 Veo 的平台积分价格或接口仍待核实，暂不提供积分报价，不会暗用平台 Key。音频分析、独立视频剪辑仍待开放，没有虚构的扣分规则。",
    ] : [
      "Batch total is the sum of output quotes. Identical settings multiply by quantity, up to four outputs. Wan 720p/5 sec costs 40 for one, 80 for two, 160 for four. Changing settings or generating again creates a new task and quote.",
      "A successful new AI script version of one shot consumes one included rewrite and no extra credits. Failures do not count; multiple shots consume one allowance per successful new version. Rewrite allowances and credits are separate.",
      "A successful video-link import consumes one import allowance, not extra credits. Pending imports temporarily hold a slot; failure releases it, and retries of the same request do not double-count. A new successful import counts again. Local file uploads do not use import allowances. Splitting and analysis are separate.",
      "Manual analysis, generation, and rewriting with your own key charge your KIE account, not platform inference credits. Automatic splitting still uses platform credits, and link imports still need their allowance. Zero platform credits does not mean free KIE usage.",
      "Sora and Veo platform pricing or adapters remain unverified, so they have no platform quote and never silently use the platform key. Audio analysis and standalone Video editing remain unopened, with no invented prices.",
    ] },
    { title: zh ? "创建任务到结算，什么时候扣费" : "From quote to settlement", steps: zh ? [
      "选择参数：生成按钮显示本次总积分预估；参考视频时长未知则显示待报价。选择自己的 Key 时显示 0 平台积分。预估本身不扣积分。",
      "获取报价：后台检测参考素材并给出每条与总积分。此时只是创建报价记录，不扣积分；未确认报价有效期为 10 分钟，关闭弹窗不会扣费。",
      "确认生成：后台检查可用余额并预留总额度。余额不足时整批不启动。确认成功后可用余额减少、任务预留增加；重复确认同一任务不重复扣费。",
      "成功生成：该条预留积分转为实际消费，不再额外扣一次。明确失败：该条预留全部释放，恢复可用余额。多条任务逐条结算，部分成功只收成功部分。",
      "超时或结果未知：积分继续预留，等待核实，不能直接当作失败退款或重复提交。查看侧栏“账户”的任务消费；联系客服时提供任务编号。分析失败按成功镜头结算，已成功交付的拆镜仍按规则收费。",
    ] : [
      "Choose settings: the button shows the estimated batch credits, or pending quote when reference timing is unknown. Your own key shows zero platform credits. Estimating does not charge credits.",
      "Get a quote: the server probes references and shows each output and the total. A quote record is not a charge. Unconfirmed quotes expire after ten minutes; closing the dialog does not charge credits.",
      "Confirm: the server checks and reserves the full batch. Insufficient balance starts none. Available credits decrease while reserved credits increase. Reconfirming the same task does not charge twice.",
      "Success settles that output's reservation without another debit. Explicit failure releases it to available balance. Outputs settle independently, so partial batches charge only successes.",
      "Timeouts and unknown results keep credits reserved for verification; they are not automatically failed or refunded. Check Account > Task usage, and give support the task ID. Analysis settles successful shots; successfully delivered splitting can still be charged.",
    ] },
  ];
}
