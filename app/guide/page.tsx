import Link from "next/link";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { ArrowRight, BookOpen, Check, ChevronDown, LifeBuoy } from "lucide-react";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { guideContent } from "./content";

export default async function GuidePage() {
  const zh = await getLocale() === "zh";
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const sections = guideContent[zh ? "zh" : "en"];
  const contents = <ol className="space-y-1">
    {sections.map((section, index) => <li key={section.id}>
      <a href={`#${section.id}`} className="group flex min-h-10 items-baseline gap-3 rounded-md px-2 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-raised)] hover:text-[var(--color-text-primary)]">
        <span className="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">{String(index + 1).padStart(2, "0")}</span>
        <span>{section.title}</span>
      </a>
    </li>)}
  </ol>;

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <SiteHeader user={session?.user ?? null} variant="light" />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-28 md:px-6 md:pt-32">
        <header className="border-b border-[var(--color-border-default)] pb-8 md:pb-10">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><BookOpen className="h-4 w-4" aria-hidden="true" />Prompt Lens / {zh ? "文档" : "Docs"}</div>
          <h1 className="mt-4 text-3xl font-semibold md:text-4xl">{zh ? "完整使用教程" : "Complete walkthrough"}</h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--color-text-secondary)]">{zh ? "从第一条参考视频开始，学会拆镜提词、改写创意和生成视频。操作步骤、费用来源与问题处理，都可以在这里找到。" : "Take your first reference from shot analysis to prompts, rewrites, and a generated video. Find the steps, understand the costs, and resolve common issues along the way."}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium">
            <Link href={session ? "/dashboard?tab=analyze" : "/login"} className="inline-flex min-h-10 items-center gap-2 text-[var(--color-accent-orange)] hover:underline underline-offset-4">{zh ? "进入工作台" : "Open workspace"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <a href="#credits" className="inline-flex min-h-10 items-center hover:underline underline-offset-4">{zh ? "先了解费用" : "Understand costs"}</a>
            <a href="#help" className="inline-flex min-h-10 items-center gap-2 hover:underline underline-offset-4"><LifeBuoy className="h-4 w-4" aria-hidden="true" />{zh ? "遇到问题" : "Get help"}</a>
          </div>
          <ol aria-label={zh ? "核心创作流程" : "Core workflow"} className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--color-border-subtle)] pt-6 sm:grid-cols-4">
            {(zh ? [["导入参考", "本地文件或视频分享链接"], ["拆镜提词", "逐镜头提取画面与运镜"], ["改写创意", "保留细节，替换你的故事"], ["生成视频", "确认参数，预览并下载"]] : [["Import", "A file or public video link"], ["Analyze", "Details and motion, shot by shot"], ["Rewrite", "Keep the structure, change the story"], ["Generate", "Review settings, preview, download"]]).map(([title, detail], index) => <li key={title} className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold"><span className="font-mono text-xs text-[var(--color-text-muted)]">0{index + 1}</span>{title}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{detail}</p>
            </li>)}
          </ol>
        </header>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14">
          <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            <nav aria-label={zh ? "教程目录" : "Guide contents"}>
              <div className="hidden lg:block">
                <p className="mb-3 px-2 text-xs font-semibold text-[var(--color-text-muted)]">{zh ? "本页目录" : "ON THIS PAGE"}</p>
                {contents}
              </div>
              <details className="group border-y border-[var(--color-border-subtle)] lg:hidden">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">{zh ? "查看教程目录" : "Browse the guide"}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
                <div className="pb-3">{contents}</div>
              </details>
            </nav>
            <Link href="/dashboard?tab=settings" className="mt-6 hidden border-t border-[var(--color-border-subtle)] px-2 pt-5 text-sm text-[var(--color-text-secondary)] underline underline-offset-4 lg:block">{zh ? "配置自己的 API Key" : "Set up your API key"}</Link>
          </aside>

          <div className="min-w-0">
            {sections.map((section, index) => <section key={section.id} id={section.id} aria-labelledby={`heading-${section.id}`} className="scroll-mt-8 border-b border-[var(--color-border-default)] py-10 first:pt-0 md:py-12">
              <p className="mb-3 font-mono text-xs text-[var(--color-text-muted)]">{zh ? "第" : "CHAPTER"} {String(index + 1).padStart(2, "0")} {zh ? "章" : ""}</p>
              <h2 id={`heading-${section.id}`} className="text-2xl font-semibold leading-snug">{section.title}</h2>
              <p className="mt-4 text-base leading-8 text-[var(--color-text-secondary)]">{section.summary}</p>

              <div className="mt-7 space-y-8">
                {section.topics.map(topic => <div key={topic.title}>
                  <h3 className="text-base font-semibold leading-7">{topic.title}</h3>
                  {topic.paragraphs && <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--color-text-secondary)]">{topic.paragraphs.map(text => <p key={text}>{text}</p>)}</div>}
                  {topic.steps && <ol className="mt-4 space-y-4">{topic.steps.map((step, stepIndex) => <li key={step} className="flex items-baseline gap-3 text-sm leading-7 text-[var(--color-text-secondary)]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-raised)] text-xs font-semibold text-[var(--color-text-primary)] ring-1 ring-[var(--color-border-default)]" aria-hidden="true">{stepIndex + 1}</span><span className="min-w-0">{step}</span></li>)}</ol>}
                  {topic.example && <figure className="mt-4 border-l-2 border-[var(--color-accent-orange)] bg-[var(--color-bg-raised)] px-4 py-4 sm:px-5"><figcaption className="mb-3 text-xs font-semibold text-[var(--color-text-primary)]">{topic.example.label}</figcaption><p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{topic.example.text}</p></figure>}
                </div>)}
              </div>

              {section.note && <aside className="mt-7 border-l-2 border-[#2f6d61] bg-[#2f6d61]/5 px-4 py-4 sm:px-5"><p className="text-sm font-semibold">{section.note.title}</p><p className="mt-2 text-sm leading-7 text-[var(--color-text-secondary)]">{section.note.text}</p></aside>}
              {section.outcome && <p className="mt-7 flex items-start gap-2 text-sm leading-7 text-[var(--color-text-secondary)]"><Check className="mt-1 h-5 w-5 shrink-0 text-[#2f6d61]" aria-hidden="true" /><span><strong className="font-medium text-[var(--color-text-primary)]">{zh ? "完成后：" : "Ready when: "}</strong>{section.outcome}</span></p>}
              {section.link && <Link href={section.link.href} className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--color-accent-orange)] hover:underline underline-offset-4">{section.link.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
            </section>)}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-sm">
              <Link href={session ? "/dashboard?tab=analyze" : "/login"} className="inline-flex min-h-11 items-center gap-2 font-medium">{zh ? "开始分析参考视频" : "Analyze a reference video"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <a href="#start" className="text-[var(--color-text-secondary)] underline underline-offset-4">{zh ? "回到第一章" : "Back to the first chapter"}</a>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
