"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("home");

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
        { label: t("footerContact"), href: "#" },
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

        <div className="pt-8 border-t border-[var(--color-border-subtle)] flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">{t("footer")}</p>
          <div className="flex items-center gap-6 text-sm text-[var(--color-text-muted)]">
            <Link href="#" className="hover:text-[var(--color-text-secondary)] transition-colors">{t("footerPrivacy")}</Link>
            <Link href="#" className="hover:text-[var(--color-text-secondary)] transition-colors">{t("footerTerms")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
