import Link from "next/link";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { SUPPORT_WECHAT } from "@/lib/support-contact";

const steps = {
  zh: [
    { id: "import", title: "导入参考视频", paragraphs: [
      "登录后进入工作台的视频分析页面。可以上传本地视频，也可以切换到视频链接，粘贴抖音、TikTok 或 B站的公开视频网址。整段「标题＋分享链接」也可以，每次只放一条链接。",
      "链接导入会先解析并将视频保存到存储服务；只有导入成功才消耗套餐中的链接导入次数，失败不扣用户积分或次数。本地文件上传不消耗链接导入次数。请使用你有权处理的素材；私密、已删除或访问受限的视频可能无法导入。",
    ] },
    { id: "breakdown", title: "自动拆镜与分析", paragraphs: [
      "选择分析模式或模型，开始处理参考视频。多镜头视频会自动划分片段，并标注起止时间。遇到费用确认时，先核对页面报价和可用额度，再确认开始。",
      "新账号的免费体验适用于 10 秒以内单镜头视频；完整多镜头工作流请按页面提示购买套餐或配置自己的 Key。自带 Key 也可以购买套餐，套餐积分可用于自动拆镜服务，模型调用费用则由你的服务商账户承担。",
      "处理时等待进度更新，不要重复提交同一任务。失败后先查看错误信息，再按提示重试；用户任务费用以成功完成的结果结算。",
    ] },
    { id: "prompts", title: "获取与修改提示词", paragraphs: [
      "分析完成后，先阅读整片解读，再逐个选择镜头，对照片段、参考画面和完整复刻提示词。提示词会整理主体、动作、环境、构图、光影与运镜等细节。",
      "可以直接复制提示词到你使用的生成工具，也可以在提示词框中修改细节。检查人物、动作和时间顺序是否符合原视频；模型分析与复刻不是绝对精确的，生成前仍需你复核。",
    ] },
    { id: "rewrite", title: "用 AI 改写自己的故事", paragraphs: [
      "在改写区域说明你想更换的人物、场景、动作或风格，再确认改写。先表达具体的变化，例如「保留运镜，把古风宫殿换成未来城市」。",
      "完成后切换原版和改写版进行对照。保留满意的细节，再继续修改其他镜头；改写的费用和次数以页面确认信息为准。",
    ] },
    { id: "generate", title: "生成与下载视频", paragraphs: [
      "先在设置中配置自己的 KIE API Key，确认服务商账户有可用余额。视频生成不使用平台提供的免费额度。不要将 Key 放到公开提示词、截图或分享链接中。",
      "选择镜头并点击「做同款」，将提示词带入生成页面。选择模型、生成方式、时长和画面比例，核对模型所需的参考素材后提交；最终相似程度取决于模型能力与素材。",
      "等待任务完成，预览生成视频后使用下载入口保存文件。失败时查看任务错误和服务商扣费记录，不要连续重复提交；不同生成模型的收费规则可能不同。",
    ] },
    { id: "help", title: "订单、退款与问题反馈", paragraphs: [
      "在「订单与退款申请」页面查看付款状态、余额及订单。已付款订单可提交退款原因和联系方式，随后与客服沟通；提交申请不会立即触发退款，审核同意后才办理。",
      `遇到问题请添加客服微信 ${SUPPORT_WECHAT}，提供订单号或任务编号、错误截图和操作步骤。不要发送 API Key 或其他密码。`,
    ] },
  ],
  en: [
    { id: "import", title: "Import a reference video", paragraphs: [
      "Sign in and open video analysis in the workspace. Upload a local video, or switch to Video link and paste a public Douyin, TikTok, or Bilibili URL. A title followed by a share link also works. Paste one link at a time.",
      "Link import resolves and stores the video first. Only successful imports consume your package's import allowance; failures consume no user credits or allowance. Local uploads do not consume link imports. Use authorized media; private, deleted, or restricted videos may not import.",
    ] },
    { id: "breakdown", title: "Detect shots and analyze", paragraphs: [
      "Choose an analysis mode or model and start processing. Multi-shot videos are divided into timestamped clips. Review the quote and available balance before confirming any charge.",
      "The new-account trial covers single-shot videos up to 10 seconds. Follow the displayed requirements for full multi-shot workflows. You can buy a package while using your own key: package credits cover automatic shot detection, while model calls use your provider account.",
      "Wait for progress updates instead of submitting duplicate tasks. Read any error before retrying. User task charges are settled against successfully completed results.",
    ] },
    { id: "prompts", title: "Get and refine prompts", paragraphs: [
      "Read the video interpretation, then select each shot and compare its clip, reference frame, and detailed recreation prompt. Prompts organize subject, action, setting, composition, lighting, and camera motion.",
      "Copy a prompt to your preferred generator or edit its details in the prompt field. Check identities, actions, and timing before generation; analysis and recreation are not guaranteed to be exact.",
    ] },
    { id: "rewrite", title: "Rewrite your own story", paragraphs: [
      "Describe the characters, setting, actions, or style you want to change in the rewrite area. Be specific: for example, keep the camera motion but replace the palace with a futuristic city.",
      "Compare the original and rewritten versions, retain the details you like, and refine other shots. Review the displayed rewrite quote and allowance before confirming.",
    ] },
    { id: "generate", title: "Generate and download", paragraphs: [
      "Configure your own KIE API key in settings and check your provider balance. Video generation does not use platform trial credits. Never put your key into public prompts, screenshots, or share links.",
      "Select a shot and choose Make same to carry its prompt into generation. Select the model, mode, duration, aspect ratio, and required reference media before submitting. Similarity depends on the model and references.",
      "Wait for completion, preview the result, and use the download control to save it. For failures, check the task error and provider billing before retrying. Billing rules vary by model.",
    ] },
    { id: "help", title: "Orders, refunds, and support", paragraphs: [
      "Open Orders and refund requests to check payment status and balances. For a paid order, submit a reason and contact details, then speak with support. Submitting the form does not issue a refund; approval is required.",
      `Contact WeChat support at ${SUPPORT_WECHAT} with your order or task ID, error screenshot, and steps. Do not send API keys or passwords.`,
    ] },
  ],
};

export default async function GuidePage() {
  const zh = await getLocale() === "zh";
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const sections = zh ? steps.zh : steps.en;
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <SiteHeader user={session?.user ?? null} variant="light" />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-28 md:px-6 md:pt-36">
        <header className="border-b border-[var(--color-border-subtle)] pb-8">
          <p className="text-sm text-[var(--color-text-secondary)]">Prompt Lens</p>
          <h1 className="mt-3 text-3xl font-semibold">{zh ? "完整使用教程" : "Complete walkthrough"}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-[var(--color-text-secondary)]">{zh ? "从参考视频到镜头提示词，再到改写与生成，按顺序完成你的第一次创作。" : "From a reference video to shot prompts, rewriting, and generation: complete your first workflow step by step."}</p>
        </header>
        <div className="mt-8 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label={zh ? "教程目录" : "Guide contents"} className="self-start lg:sticky lg:top-24">
            <ol className="space-y-3 text-sm">
              {sections.map((section, index) => <li key={section.id}><a href={`#${section.id}`} className="leading-6 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">{index + 1}. {section.title}</a></li>)}
            </ol>
          </nav>
          <div className="min-w-0">
            {sections.map((section, index) => <section key={section.id} id={section.id} className="scroll-mt-28 border-b border-[var(--color-border-subtle)] py-8 first:pt-0">
              <h2 className="text-xl font-semibold">{index + 1}. {section.title}</h2>
              <div className="mt-4 space-y-4 text-sm leading-7 text-[var(--color-text-secondary)]">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              {section.id === "generate" && <Link href="/dashboard?tab=settings" className="mt-4 inline-block text-sm underline underline-offset-4">{zh ? "前往设置配置 Key" : "Configure your key in settings"}</Link>}
              {section.id === "help" && <Link href="/billing" className="mt-4 inline-block text-sm underline underline-offset-4">{zh ? "订单与退款申请" : "Orders and refund requests"}</Link>}
            </section>)}
            <Link href={session ? "/dashboard?tab=analyze" : "/login"} className="mt-8 inline-flex items-center gap-2 text-sm font-medium">{zh ? "开始分析参考视频" : "Analyze a reference video"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
