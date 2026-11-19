import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { ArrowRight, BookOpen, CreditCard } from "lucide-react";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { PricingSection } from "@/components/landing/pricing-section";
import { creditRuleTopics } from "@/app/guide/credit-rules";

export async function generateMetadata(): Promise<Metadata> {
  const zh = await getLocale() === "zh";
  const title = zh ? "价格、套餐与完整计费规则 | Prompt Lens" : "Pricing, packages & full credit rules | Prompt Lens";
  const description = zh
    ? "免登录查看 Prompt Lens 套餐价格、积分、自动拆镜、视频分析、AI 视频生成与编辑的完整计费明细，以及自带 API Key 的费用规则。"
    : "Public pricing for Prompt Lens packages, splitting, analysis, video generation, editing, and bring-your-own-key usage.";
  return {
    title,
    description,
    alternates: { canonical: "/pricing" },
    openGraph: { title, description, url: "/pricing" },
  };
}

export default async function PricingPage() {
  const zh = await getLocale() === "zh";
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  // Render from the same pricing rules as /guide#credits so amounts stay in sync.
  // These are platform-credit examples, not Infistar / KIE BYOK API prices.
  const topics = creditRuleTopics(zh);

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <SiteHeader user={session?.user ?? null} variant="light" />
      <main>
        <header className="mx-auto max-w-6xl px-4 pb-10 pt-28 md:px-6 md:pt-32">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Prompt Lens / {zh ? "公开价格" : "Public pricing"}
          </div>
          <h1 className="mt-4 font-serif-display text-4xl text-[var(--color-text-primary)] md:text-5xl">
            {zh ? "套餐价格与完整计费规则" : "Packages & complete pricing"}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--color-text-secondary)]">
            {zh
              ? "这里集中展示所有套餐额度、拆镜和分析费用、各类视频生成及编辑的积分价格，以及自带 API Key 的费用说明。无需注册或登录即可查阅。"
              : "Compare package allowances, splitting and analysis charges, generation and editing credit rates, and bring-your-own-key billing. No account is needed to read this page."}
          </p>
          <nav aria-label={zh ? "定价页导航" : "Pricing sections"} className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium">
            <a href="#pricing" className="inline-flex min-h-10 items-center gap-2 text-[var(--color-accent-orange)] hover:underline underline-offset-4">
              {zh ? "查看套餐" : "View packages"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a href="#pricing-rules" className="inline-flex min-h-10 items-center gap-2 hover:underline underline-offset-4">
              {zh ? "查看全部计费明细" : "View all credit rates"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link href="/refund" className="inline-flex min-h-10 items-center hover:underline underline-offset-4">
              {zh ? "退款与取消政策" : "Refund & cancellation policy"}
            </Link>
          </nav>
        </header>

        <PricingSection isAuthenticated={Boolean(session?.user)} />

        <section id="pricing-rules" aria-labelledby="pricing-rules-title" className="scroll-mt-10 mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
          <div className="border-b border-[var(--color-border-default)] pb-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {zh ? "完整价格清单" : "Full rate card"}
            </p>
            <h2 id="pricing-rules-title" className="mt-3 text-2xl font-semibold md:text-3xl">
              {zh ? "各项服务分别如何计费？" : "How each service is billed"}
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--color-text-secondary)]">
              {zh
                ? "下方模型表是 Prompt Lens 平台积分参考价，只有已开放且支持的组合才可下单；不代表向 Infistar 或 KIE 使用自带 Key 的供应商价格。表格中的「-」表示该组合不可用，不代表免费。实际费用以任务提交前确认的报价为准。"
                : "Model tables show Prompt Lens platform-credit rates for supported configurations, not charges from Infistar or KIE when using your own key. A dash means unavailable, not free. Your confirmed quote before submission determines the actual charge."}
            </p>
          </div>

          <div className="mt-9 grid items-start gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
            <nav aria-label={zh ? "计费规则目录" : "Pricing rule index"} className="lg:sticky lg:top-6">
              <p className="mb-3 text-xs font-semibold text-[var(--color-text-muted)]">{zh ? "快速跳转" : "JUMP TO"}</p>
              <ol className="space-y-1">
                {topics.map((topic, index) => (
                  <li key={topic.title}>
                    <a href={"#price-rule-" + index} className="block rounded-md px-2 py-2 text-sm leading-6 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-raised)] hover:text-[var(--color-text-primary)]">
                      {topic.title}
                    </a>
                  </li>
                ))}
              </ol>
              <Link href="/guide#credits" className="mt-5 inline-flex min-h-10 items-center gap-2 border-t border-[var(--color-border-subtle)] px-2 pt-4 text-sm underline underline-offset-4">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                {zh ? "查看使用教程" : "Read usage guide"}
              </Link>
            </nav>

            <div className="min-w-0 space-y-11">
              {topics.map((topic, index) => (
                <section key={topic.title} id={"price-rule-" + index} aria-labelledby={"price-rule-heading-" + index} className="scroll-mt-10 border-b border-[var(--color-border-subtle)] pb-10 last:border-0">
                  <h3 id={"price-rule-heading-" + index} className="text-xl font-semibold leading-8">{topic.title}</h3>
                  {topic.paragraphs && (
                    <div className="mt-4 space-y-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                      {topic.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                    </div>
                  )}
                  {topic.table && (
                    <div className="mt-6 max-w-full overflow-x-auto rounded-lg border border-[var(--color-border-default)]" role="region" aria-label={topic.title} tabIndex={0}>
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">{topic.title}</caption>
                        <thead className="bg-[var(--color-bg-raised)]">
                          <tr>{topic.table.columns.map((column, columnIndex) => (
                            <th key={column + columnIndex} scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">{column}</th>
                          ))}</tr>
                        </thead>
                        <tbody>{topic.table.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-t border-[var(--color-border-subtle)]">
                            {row.map((value, cellIndex) => cellIndex === 0
                              ? <th key={cellIndex} scope="row" className="whitespace-nowrap px-3 py-3 font-medium">{value}</th>
                              : <td key={cellIndex} className="whitespace-nowrap px-3 py-3 text-[var(--color-text-secondary)]">{value}</td>)}
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
              <aside className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5 text-sm leading-7">
                <p className="font-semibold">{zh ? "关于付款、退款和实际可用性" : "About payment, refunds and availability"}</p>
                <p className="mt-2 text-[var(--color-text-secondary)]">
                  {zh
                    ? "套餐以人民币为基价，一次性购买，不自动续费。开放付款后可选择支持的结账币种，外币按下单时汇率换算并锁价；税费在结账页展示。标注「待开放」的套餐暂不可购买。平台积分、改写次数、链接导入次数和供应商余额互不等同。新任务以提交前确认报价为准，付款及退款以订单状态和公示政策为准。"
                    : "Packages use a CNY base price, with one-time purchases and no auto-renewal. When checkout is available, choose a supported currency; converted prices are locked when ordering and tax is shown at checkout. Coming soon means not currently purchasable. Platform credits, rewrite allowances, link-import allowances and API-provider balances are separate. Confirm each task quote; payment and refunds follow your order status and the published policy."}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                  <Link href="/refund" className="underline underline-offset-4">{zh ? "退款政策" : "Refund policy"}</Link>
                  <Link href="/terms" className="underline underline-offset-4">{zh ? "服务条款" : "Terms of service"}</Link>
                  <Link href="/guide#credits" className="underline underline-offset-4">{zh ? "积分使用教程" : "Credit usage guide"}</Link>
                </div>
              </aside>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
