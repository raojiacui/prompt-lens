"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Image from "next/image";

const blogKeys = ["blog1", "blog2", "blog3"] as const;

export function BlogSection() {
  const t = useTranslations("home");

  return (
    <section id="blog" className="py-16 md:py-24 lg:py-32 bg-[var(--color-bg-base)]">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold text-[var(--color-text-primary)] mb-4">
            {t("blogTitle")}
          </h2>
          <p className="text-lg text-[var(--color-text-secondary)]">{t("blogSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {blogKeys.map((key) => (
            <article
              key={key}
              className="group bg-[var(--color-bg-raised)] rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] hover:border-[#D97757]/30 hover:-translate-y-1 transition-all duration-300 shadow-sm"
            >
              <div className="relative aspect-[16/10] bg-[#EDE5D8] overflow-hidden">
                <Image
                  src="/screenshot-dashboard.png"
                  alt={t(`${key}Title`)}
                  fill
                  className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                />
              </div>
              <div className="p-6">
                <span className="inline-block px-2.5 py-1 rounded-md bg-[#EDE5D8] text-xs font-medium text-[var(--color-text-secondary)] mb-3">
                  {t(`${key}Tag`)}
                </span>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2 line-clamp-2">
                  {t(`${key}Title`)}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4 line-clamp-2">
                  {t(`${key}Excerpt`)}
                </p>
                <Button variant="ghost" className="p-0 h-auto text-[#D97757] hover:text-[#C96848] hover:bg-transparent gap-1">
                  {t("blogReadMore")}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
