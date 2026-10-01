"use client";

import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SUPPORT_WECHAT, PARTNERSHIP_EMAIL } from "@/lib/support-contact";

export function SiteFooter() {
  const t = useTranslations("home");
  const zh = useLocale() === "zh";

  const footerLinks = [
    {
      title: t("footerProduct"),
      links: [
        { label: t("footerFeatures"), href: "#features" },
        { label: t("footerPricing"), href: "#pricing" },
        { label: t("footerDemo"), href: "#demo" },
      ],
    },
    {
      title: t("footerResources"),
      links: [
        { label: t("footerArticles"), href: "#articles" },
        { label: t("footerBlog"), href: "#blog" },
        { label: t("footerFaq"), href: "#faq" },
      ],
    },
    {
      title: t("footerCompany"),
      links: [
        { label: t("footerAbout"), href: "#" },
        { label: t("footerContact"), href: "#support" },
      ],
    },
  ];

  return (
    <footer className="bg-[var(--color-bg-base)] border-t border-[var(--color-border-subtle)] py-12 md:py-16">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-1">
            <Link href="/" className="mb-4 inline-flex items-center gap-3" aria-label="Prompt Lens">
              <Image
                src="/prompt-lens-icon.png"
                alt="Prompt Lens"
                width={541}
                height={563}
                className="h-12 w-auto object-contain"
              />
              <span className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight">Prompt Lens</span>
            </Link>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t("footerTagline")}
            </p>
          </div>

          {footerLinks.map((group) => (
            <div key={group.title}>
              <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-4">{group.title}</h4>
              <ul className="space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div id="support" className="mb-8 grid gap-6 border-t border-[var(--color-border-subtle)] pt-8 text-sm md:grid-cols-2">
          <div><h4 className="font-medium">{zh ? "如有问题，请联系客服" : "Questions? Contact customer support"}</h4><p className="mt-2 break-words text-[var(--color-text-secondary)]">{zh ? "微信添加：" : "Add us on WeChat: "}{SUPPORT_WECHAT}</p><p className="mt-2 text-[var(--color-text-secondary)]">{zh ? "退款请先提交申请表单，再与客服沟通，审核同意后办理。" : "For refunds, submit the request form and contact support. Refunds are issued only after approval."}</p><Link href="/billing" className="mt-2 inline-block underline underline-offset-4">{zh ? "订单与退款申请" : "Orders and refund requests"}</Link></div>
          <div>
            <h4 className="font-medium">{zh ? "合作请联系邮箱" : "Partnership inquiries"}</h4>
            <a href={`mailto:${PARTNERSHIP_EMAIL}`} className="mt-2 inline-flex max-w-full items-center gap-2 text-[var(--color-text-secondary)]">
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all underline underline-offset-4">{PARTNERSHIP_EMAIL}</span>
            </a>
          </div>
        </div>
        <div className="pt-8 border-t border-[var(--color-border-subtle)] flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">{t("footer")}</p>
        </div>
      </div>
    </footer>
  );
}
