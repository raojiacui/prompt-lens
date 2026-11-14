import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { policyContent, POLICY_LINKS, POLICY_UPDATED_AT, type PolicyKind } from "@/lib/legal-content";
import { PARTNERSHIP_EMAIL, SUPPORT_WECHAT } from "@/lib/support-contact";

export async function policyMetadata(kind: PolicyKind): Promise<Metadata> {
  const locale = await getLocale() === "zh" ? "zh" : "en";
  const document = policyContent[locale][kind];
  const path = POLICY_LINKS.find(link => link.kind === kind)!.href;
  return {
    title: `${document.title} | Prompt Lens`,
    description: document.summary,
    alternates: { canonical: path },
    openGraph: { title: `${document.title} | Prompt Lens`, description: document.summary, url: path },
  };
}

export async function LegalDocument({ kind }: { kind: PolicyKind }) {
  const zh = await getLocale() === "zh";
  const document = policyContent[zh ? "zh" : "en"][kind];

  return (
    <main className="mx-auto max-w-4xl px-4 pb-20 pt-28 md:px-6 md:pt-32">
      <header className="border-b border-[var(--color-border-default)] pb-8">
        <p className="text-sm text-[var(--color-text-secondary)]">Prompt Lens / {zh ? "条款与政策" : "Terms & policies"}</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-4xl">{document.title}</h1>
        <p className="mt-4 leading-8 text-[var(--color-text-secondary)]">{document.summary}</p>
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">{zh ? "更新日期：" : "Last updated: "}<time dateTime={POLICY_UPDATED_AT}>{POLICY_UPDATED_AT}</time></p>
        <nav aria-label={zh ? "条款与政策导航" : "Policy navigation"} className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {POLICY_LINKS.map(link => <Link key={link.kind} href={link.href} aria-current={link.kind === kind ? "page" : undefined} className="inline-flex min-h-11 items-center underline underline-offset-4 aria-[current=page]:font-semibold">{zh ? link.zh : link.en}</Link>)}
        </nav>
      </header>

      <article className="divide-y divide-[var(--color-border-subtle)]">
        {document.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={`policy-${section.id}`} className="scroll-mt-24 py-7 md:py-9">
          <h2 id={`policy-${section.id}`} className="text-xl font-semibold leading-8">{section.title}</h2>
          <div className="mt-4 space-y-4 text-sm leading-8 text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
        </section>)}
      </article>

      <aside id="contact" className="mt-6 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{zh ? "联系运营者与客服" : "Contact the operator and support"}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">{zh ? "Prompt Lens 个人开发者 · 收费、退款、隐私、内容举报与申诉" : "Prompt Lens individual developer · Billing, refunds, privacy, content reports and appeals"}</p>
        <a href={`mailto:${PARTNERSHIP_EMAIL}`} className="mt-2 inline-flex min-h-11 items-center break-all text-sm underline underline-offset-4">{PARTNERSHIP_EMAIL}</a>
        <p className="text-sm leading-7 text-[var(--color-text-secondary)]">{zh ? "客服微信：" : "WeChat support: "}{SUPPORT_WECHAT}</p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/billing#refund-request" className="inline-flex min-h-11 items-center underline underline-offset-4">{zh ? "订单与退款申请（需登录）" : "Orders and refund requests (sign-in required)"}</Link>
          <Link href="/guide#help" className="inline-flex min-h-11 items-center underline underline-offset-4">{zh ? "使用教程与帮助" : "Guide and help"}</Link>
        </div>
      </aside>
    </main>
  );
}
