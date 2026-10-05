import { COMMERCIAL_PACKAGES, estimateGeneration, quoteAnalysis, splitCredits } from "@/lib/billing/pricing-v6";
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
  const analysisRows = [1, 5, 10].map(seconds => {
    const sourceDurationUs = seconds * 1e6;
    const scenes = [{ id: "single-shot", startUs: 0, endUs: sourceDurationUs }];
    const input = { payer: "platform" as const, sourceDurationUs, scenes, automaticSplit: false, paidSplitReusable: false };
    const flash = quoteAnalysis({ ...input, model: "flash" });
    return [zh ? `${seconds} 秒` : `${seconds} sec`, String(flash.analysisCredits)];
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
  ];
  const durationColumns = zh ? ["5 秒", "10 秒", "15 秒"] : ["5 sec", "10 sec", "15 sec"];
  return [
    { title: zh ? "套餐包含哪些额度" : "Package allowances", paragraphs: [zh ? "三个套餐的通用积分适用于同一套已开放功能，不按套餐锁定模型。表内积分均为平台积分，不是 KIE 点数。金额为人民币；每次使用仍需足够可用余额。" : "All packages use the same wallet and supported features. These are Prompt Lens credits, not KIE credits. Prices are in CNY; each task needs sufficient available credits."], table: {
      columns: zh ? ["套餐", "价格", "通用积分", "改写次数", "链接导入次数"] : ["Package", "CNY", "Credits", "Rewrites", "Link imports"],
      rows: COMMERCIAL_PACKAGES.map((p, i) => [zh ? p.name : ["Starter", "Creator", "Volume"][i], (p.priceCents / 100).toFixed(2), String(p.credits), String(p.rewrites), String(p.linkImports)]),
    } },
    { title: zh ? "自动拆镜费用（不含模型分析）" : "Automatic splitting (analysis not included)", paragraphs: zh ? [
      "自动拆镜按原视频完整时长收费，与选用哪个分析模型、拆出多少个镜头无关。下表仅列拆镜费用，不包含任何镜头分析费。",
      "不使用自动拆镜、直接分析上传的完整单镜头文件：拆镜费为 0。使用自动拆镜处理 10 秒视频：拆镜费为 2 积分。这是两种操作，不是同一种操作有两个价格。已支付且可复用的拆镜结果不重复收费。",
    ] : [
      "Automatic splitting is priced by full source duration, independent of the analysis model or resulting shot count. This table includes splitting only, not shot analysis.",
      "Analyzing a complete single-shot upload without automatic splitting has no splitting fee. Automatically splitting a 10-second source costs 2 credits. These are different operations, not two prices for the same operation. Reusable splitting that was already paid is not charged again.",
    ], table: { columns: zh ? ["原视频时长", "自动拆镜积分"] : ["Source duration", "Splitting credits"], rows: [5, 10, 30, 60].map(seconds => [zh ? `${seconds} 秒` : `${seconds} sec`, String(splitCredits(seconds * 1e6))]) } },
    { title: zh ? "分析一个镜头扣多少积分" : "Analysis credits for one shot", paragraphs: zh ? [
      "下表每个数字都是用对应模型成功分析一个镜头所需的平台积分，不含拆镜费，不是整条视频的合计费用。镜头时长指这一个镜头自身的时长，不是原视频时长。",
      "例如，一个 10 秒镜头：Gemini 3.8 Flash 扣 5 积分。平台积分分析使用 Gemini 3.8 Flash；使用自己的 Key 时，可选择页面上其他已开放的分析模型，不扣平台分析积分。",
      "可以全选或只分析某几个镜头，未选中的镜头不收分析费。其他镜头时长、一次选择多个镜头时，以分析按钮和确认页的报价为准。",
      "部分镜头失败只收成功镜头的分析费用；平台分析全部失败不收本次拆镜和分析费用。失败重试不重复收已支付的拆镜费和成功镜头费用。自带 Key 的模型分析不扣平台积分，自动拆镜仍按原视频时长收费。",
      "上传视频文件只支持 10 秒以内的完整单镜头片段，不拆镜；包含多个镜头可能影响分析效果，请自行确认素材。视频文件最大 100MB。粘贴链接导入的原视频不限时长，先拆镜，再选择镜头分析；其他镜头时长以分析按钮及确认页显示的积分为准。",
      "新账号的两次免费体验只用于符合条件的 10 秒以内单镜头分析，不适用于视频生成。试用用完后，不会自动继续使用平台 Key；需要购买额度或选择自己的 Key。",
    ] : [
      "Each number is the platform credit cost of successfully analyzing one shot with the named model. Splitting is not included; these are not full-video totals. Duration means the length of that individual shot, not the full source.",
      "One 10-second shot costs 5 credits with Gemini 3.8 Flash. Platform-credit analysis uses Gemini 3.8 Flash. With your own key, other available analysis models charge your provider account, not platform analysis credits.",
      "Analyze all shots or a selected subset. Unselected shots incur no analysis fee. For other shot lengths or multiple selected shots, use the quote on the analysis button and confirmation page.",
      "Failed shots incur no analysis charge. If all platform analysis fails, neither splitting nor analysis is charged for that attempt. Retries do not charge paid splitting or successful shots again. Your own key pays model costs through KIE; automatic splitting still uses platform credits.",
      "Video file uploads support one complete shot up to 10 seconds without splitting, within 100MB. Multiple shots may reduce analysis quality; check your footage. Linked videos have no source-duration cap and are split before selecting shots for analysis. Other shot lengths are quoted on the analysis button and confirmation page.",
      "Two introductory trials apply only to eligible single-shot analysis within 10 seconds, not generation. After trials, purchase credits or explicitly use your own key; the platform key is not an automatic fallback.",
    ], table: { columns: zh ? ["单个镜头时长", "Gemini 3.8 Flash（积分/镜头）"] : ["Single-shot duration", "Gemini 3.8 Flash (credits/shot)"], rows: analysisRows } },
    { title: zh ? "文字、图片生成积分表（每条）" : "Text and image generation (per output)", paragraphs: zh ? [
      "下表每个数字都是生成一条视频的积分。Wan 文生、单图生成同配置价格相同；Seedance 文字和图片参考使用同一档价格；Kling 2.6 此处为文字生成，Kling 3 支持文字和图片。素材数量、比例等仍需符合模型限制。",
      "Wan 支持 5、10、15 秒；Seedance 支持 4–15 秒；Kling 2.6 支持 5、10 秒；Kling 3 支持 3–15 秒。表中“-”表示当前未支持该组合，不代表免费。其他支持时长的积分会显示在生成按钮与确认报价中。",
      "Kling 有声与无声价格分别列出；以当前页面可选的声音配置为准。",
    ] : [
      "Each number is the price of one output. Wan text and single-image modes share these rates. Seedance text and image references share their tier. Kling 2.6 here is text-only; Kling 3 supports text and images. Input and aspect-ratio limits still apply.",
      "Wan supports 5/10/15 seconds; Seedance 4–15; Kling 2.6 5/10; Kling 3 3–15. A dash means unsupported, not free. Other supported durations are priced on the generation button and confirmation quote.",
      "Kling audio and silent prices are listed separately. Use the audio configuration available on the current page.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", zh ? "声音配置" : "Audio", ...durationColumns], rows: ordinary.map(([name, model, resolution, audio]) => [name, resolution, audio ? (zh ? "有声" : "On") : (model.startsWith("kling") ? (zh ? "无声" : "Off") : (zh ? "模型默认" : "Model default")), ...[5, 10, 15].map(s => price(model, resolution, s, audio))]) } },
    { title: zh ? "Veo 3.1 生成积分表（每条）" : "Veo 3.1 generation credits (per output)", paragraphs: zh ? [
      "文字生成、单图生成、首尾两张图片生成支持 4、6、8 秒；同一档位、画质按条收费，这三个时长扣相同积分。每条视频带模型默认音轨，部分内容可能不输出声音。",
      "三张素材图片参考仅 Lite、Fast 支持，且固定 8 秒，同档位画质的费用与下表一致。Veo 不支持在这里上传参考视频。",
      "Quality 4K 仍未开放，因为供应商价目字段不一致。表中“-”表示不可用，不代表免费。多条生成扣费以按钮显示的总积分为准。",
    ] : [
      "Text, single-image, and first/last-frame generation support 4, 6, and 8 seconds. Each output is charged a flat price for its tier and resolution, so all three durations cost the same. Audio is model-default and may be absent for some content.",
      "Three-image material reference is available in Lite and Fast only, at 8 seconds, for the same listed credits. Uploaded reference videos are not supported by Veo.",
      "Quality 4K remains unavailable because provider price fields disagree. A dash means unavailable, not free. Batch totals appear on the generation button.",
    ], table: { columns: [zh ? "模型" : "Model", "720p", "1080p", "4K"], rows: [
      ["Veo 3.1 Lite", ...["720p", "1080p", "4k"].map(r => price("veo3_lite", r, 8))],
      ["Veo 3.1 Fast", ...["720p", "1080p", "4k"].map(r => price("veo3_fast", r, 8))],
      ["Veo 3.1 Quality", ...["720p", "1080p", "4k"].map(r => price("veo3", r, 8))],
    ] } },
    { title: zh ? "参考视频生成（输入视频为 5 秒）" : "Reference generation (5-second input)", paragraphs: zh ? [
      "下表为参考视频 5 秒时，生成一条视频所需的积分；列标题为输出视频时长。其他参考时长以页面显示的积分为准。",
    ] : [
      "The table shows credits per output with a five-second reference video. Column headings are output durations. For other reference durations, use the credits shown on the page.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", ...durationColumns], rows: referenceModels.map(([name, model, resolution]) => [name, resolution, ...[5, 10, 15].map(s => price(model, resolution, s, false, 5))]) } },
    { title: zh ? "视频编辑（按输出时长）" : "Video editing (output duration)", paragraphs: zh ? [
      "这里指视频生成中的编辑模型，不是待开放的独立“视频剪辑”工具。下表为输入与输出等长、无额外音频选项时，每条视频所需的积分；其他配置以页面显示的积分为准。",
      "Wan 2.7 支持 2–10 秒，输出时长不得超过输入视频时长。",
    ] : [
      "These are editing models inside video generation, not the unopened standalone Video editing tool. The table shows credits per output with equally long input and output and no extra audio option. Use the credits shown on the page for other configurations.",
      "Wan 2.7 supports 2–10 seconds; output duration cannot exceed the input-video duration.",
    ], table: { columns: [zh ? "模型" : "Model", zh ? "画质" : "Quality", ...[5, 10, 15, 30, 60].map(s => zh ? `${s} 秒` : `${s} sec`)], rows: editing.map(([name, model, resolution]) => [name, resolution, ...[5, 10, 15, 30, 60].map(s => price(model, resolution, s, false, s))]) } },
    { title: zh ? "条数、改写、导入与自己的 Key" : "Batch size, rewrites, imports, and your key", paragraphs: zh ? [
      "一次最多生成 4 条视频。例如 Wan 720p、5 秒：1 条扣 40 积分，2 条扣 80，4 条扣 160。其他配置和条数以生成按钮显示的总积分为准；重新生成需再次付费。",
      "一个镜头成功生成一个新的 AI 改写版本，消耗 1 次套餐改写额度、0 额外平台积分；失败不计次。一次处理多个镜头按成功的新版本数量计次。改写次数与通用积分不可互换。",
      "成功导入一个视频链接消耗 1 次链接导入额度、0 额外平台积分；失败不计次。手动上传本地文件不消耗导入次数。分析、拆镜单独收费。",
      "自带 Key 的手动分析、生成、改写不扣平台推理积分，模型费用从自己的 KIE 账户扣。自动拆镜仍扣平台积分，链接导入仍需要对应额度。“0 平台积分”不表示 KIE 免费。",
      "Veo 已接入平台积分支付，支持组合和费用见上表。音频分析、独立视频剪辑仍待开放。",
    ] : [
      "Generate up to four outputs at once. Wan 720p, 5 seconds costs 40 credits for one output, 80 for two, and 160 for four. For other settings and quantities, use the total shown on the generation button. Generating again is a new paid task.",
      "A successful new AI script version of one shot consumes one included rewrite and no extra credits. Failures do not count; multiple shots consume one allowance per successful new version. Rewrite allowances and credits are separate.",
      "A successful video-link import uses one import allowance and no extra platform credits. Failed imports do not count. Local file uploads do not use import allowances. Splitting and analysis are charged separately.",
      "Manual analysis, generation, and rewriting with your own key charge your KIE account, not platform inference credits. Automatic splitting still uses platform credits, and link imports still need their allowance. Zero platform credits does not mean free KIE usage.",
      "Veo supports platform credits for the configurations listed above. Audio analysis and standalone Video editing remain Coming soon.",
    ] },
  ];
}
