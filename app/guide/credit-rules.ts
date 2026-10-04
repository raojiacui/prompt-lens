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
      "自动拆镜：5 秒扣 1 积分，10 秒扣 2，30 秒扣 5，60 秒扣 10。已支付且可复用的拆镜结果不重复收费。",
      "下表为对应时长和镜头数量全部分析成功时的总积分，标为“包含”的费用已含自动拆镜。当前付费分析支持最多 60 秒、20 个镜头；其他组合以页面显示的积分为准。",
      "新账号的两次免费体验只用于符合条件的 10 秒以内单镜头分析，不适用于视频生成。试用用完后，不会自动继续使用平台 Key；需要购买额度或选择自己的 Key。",
    ] : [
      "Automatic splitting costs 1 credit for 5 seconds, 2 for 10 seconds, 5 for 30 seconds, and 10 for 60 seconds. Reusable splitting that was already paid is not charged again.",
      "The table shows total credits when all listed shots are successfully analyzed. Rows marked Included cover automatic splitting. Paid analysis supports up to 60 seconds and 20 shots; check the credits shown on the page for other combinations.",
      "Two introductory trials apply only to eligible single-shot analysis within 10 seconds, not generation. After trials, purchase credits or explicitly use your own key; the platform key is not an automatic fallback.",
    ], table: { columns: zh ? ["总秒数", "镜头数", "拆镜", "Flash 总积分", "Pro 总积分"] : ["Seconds", "Shots", "Splitting", "Flash credits", "Pro credits"], rows: analysisRows } },
    { title: zh ? "文字、图片生成积分表（每条）" : "Text and image generation (per output)", paragraphs: zh ? [
      "下表每个数字都是生成一条视频的积分。Wan 文生、单图生成同配置价格相同；Seedance 文字和图片参考使用同一档价格；Kling 2.6 此处为文字生成，Kling 3 支持文字和图片。素材数量、比例等仍需符合模型限制。",
      "Wan 支持 5、10、15 秒；Seedance 支持 4–15 秒；Kling 2.6 支持 5、10 秒；Kling 3 支持 3–15 秒。表中“-”表示当前未支持该组合，不代表免费。其他支持时长的积分会显示在生成按钮与确认报价中。",
      "Kling 有声与无声价格分别列出；以当前页面可选的声音配置为准。",
    ] : [
      "Each number is the price of one output. Wan text and single-image modes share these rates. Seedance text and image references share their tier. Kling 2.6 here is text-only; Kling 3 supports text and images. Input and aspect-ratio limits still apply.",
      "Wan supports 5/10/15 seconds; Seedance 4–15; Kling 2.6 5/10; Kling 3 3–15. A dash means unsupported, not free. Other supported durations are priced on the generation button and confirmation quote.",
      "Kling audio and silent prices are listed separately. Use the audio configuration available on the current page.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", zh ? "声音配置" : "Audio", ...durationColumns], rows: ordinary.map(([name, model, resolution, audio]) => [name, resolution, audio ? (zh ? "有声" : "On") : (model.startsWith("kling") ? (zh ? "无声" : "Off") : (zh ? "模型默认" : "Model default")), ...[5, 10, 15].map(s => price(model, resolution, s, audio))]) } },
    { title: zh ? "Grok 文字生成" : "Grok text generation", table: { columns: [zh ? "画质" : "Quality", zh ? "6 秒" : "6 sec", zh ? "10 秒" : "10 sec"], rows: [["720p", price("grok-imagine/text-to-video", "720p", 6), price("grok-imagine/text-to-video", "720p", 10)]] } },
    { title: zh ? "参考视频生成（输入视频为 5 秒）" : "Reference generation (5-second input)", paragraphs: zh ? [
      "下表为参考视频 5 秒时，生成一条视频所需的积分；列标题为输出视频时长。其他参考时长以页面显示的积分为准。",
    ] : [
      "The table shows credits per output with a five-second reference video. Column headings are output durations. For other reference durations, use the credits shown on the page.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", ...durationColumns], rows: referenceModels.map(([name, model, resolution]) => [name, resolution, ...[5, 10, 15].map(s => price(model, resolution, s, false, 5))]) } },
    { title: zh ? "视频编辑（按输出时长）" : "Video editing (output duration)", paragraphs: zh ? [
      "这里指视频生成中的编辑模型，不是待开放的独立“视频剪辑”工具。下表为输入与输出等长、无额外音频选项时，每条视频所需的积分；其他配置以页面显示的积分为准。",
      "Wan 2.7：2–10 秒；HappyHorse：保持原视频长度，3–60 秒；Kling Omni：受参考素材与模式限制，纯视频参考通常保持原长度，多图编辑的输出时长与素材需匹配模型要求。",
    ] : [
      "These are editing models inside video generation, not the unopened standalone Video editing tool. The table shows credits per output with equally long input and output and no extra audio option. Use the credits shown on the page for other configurations.",
      "Wan 2.7: 2–10 seconds. HappyHorse: original duration, 3–60 seconds. Kling Omni depends on the reference mode; video-only typically preserves source duration, while image-assisted edits must satisfy the model's output and input limits.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", ...[5, 10, 15, 30, 60].map(s => zh ? `${s} 秒` : `${s} sec`)], rows: editing.map(([name, model, resolution]) => [name, resolution, ...[5, 10, 15, 30, 60].map(s => price(model, resolution, s, false, s))]) } },
    { title: zh ? "条数、改写、导入与自己的 Key" : "Batch size, rewrites, imports, and your key", paragraphs: zh ? [
      "一次最多生成 4 条视频。例如 Wan 720p、5 秒：1 条扣 40 积分，2 条扣 80，4 条扣 160。其他配置和条数以生成按钮显示的总积分为准；重新生成需再次付费。",
      "一个镜头成功生成一个新的 AI 改写版本，消耗 1 次套餐改写额度、0 额外平台积分；失败不计次。一次处理多个镜头按成功的新版本数量计次。改写次数与通用积分不可互换。",
      "成功导入一个视频链接消耗 1 次链接导入额度、0 额外平台积分；失败不计次。手动上传本地文件不消耗导入次数。分析、拆镜单独收费。",
      "自带 Key 的手动分析、生成、改写不扣平台推理积分，模型费用从自己的 KIE 账户扣。自动拆镜仍扣平台积分，链接导入仍需要对应额度。“0 平台积分”不表示 KIE 免费。",
      "Sora 和 Veo 暂不支持平台积分支付。音频分析、独立视频剪辑仍待开放。",
    ] : [
      "Generate up to four outputs at once. Wan 720p, 5 seconds costs 40 credits for one output, 80 for two, and 160 for four. For other settings and quantities, use the total shown on the generation button. Generating again is a new paid task.",
      "A successful new AI script version of one shot consumes one included rewrite and no extra credits. Failures do not count; multiple shots consume one allowance per successful new version. Rewrite allowances and credits are separate.",
      "A successful video-link import uses one import allowance and no extra platform credits. Failed imports do not count. Local file uploads do not use import allowances. Splitting and analysis are charged separately.",
      "Manual analysis, generation, and rewriting with your own key charge your KIE account, not platform inference credits. Automatic splitting still uses platform credits, and link imports still need their allowance. Zero platform credits does not mean free KIE usage.",
      "Sora and Veo do not currently support platform credits. Audio analysis and standalone Video editing remain Coming soon.",
    ] },
  ];
}
