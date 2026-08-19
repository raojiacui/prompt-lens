"use client";

import { useTranslations } from "next-intl";
import { Target, Repeat, FileText, Palette } from "lucide-react";

const icons = [Target, Repeat, FileText, Palette];
const keys = ["advantage1", "advantage2", "advantage3", "advantage4"] as const;

export function AdvantagesSection() {
  const t = useTranslations("home");

  return (
    <section id="why-us" className="py-16 md:py-24 lg:py-32 bg-[#F2EBE0]/50">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
            {t("advantagesTag")}
          </p>
          <h2 className="text-3xl md:text-4xl font-normal font-serif-display text-[var(--color-text-primary)] mb-4">
            {t("advantagesTitle")}
          </h2>
          <p className="text-lg text-[var(--color-text-secondary)]">{t("advantagesSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {keys.map((key, index) => {
            const Icon = icons[index];
            return (
              <div
                key={key}
                className="group bg-[var(--color-bg-raised)] rounded-2xl p-6 border border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)] hover:-translate-y-1 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-[#EDE5D8] text-[var(--color-text-secondary)] flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                  {t(`${key}Title`)}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  {t(`${key}Desc`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
