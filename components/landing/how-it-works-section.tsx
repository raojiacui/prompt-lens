"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Upload, Sparkles, Sliders, Download, ArrowRight } from "lucide-react";

const stepIcons = [Upload, Sparkles, Sliders, Download];
const stepKeys = ["howItWorksStep1", "howItWorksStep2", "howItWorksStep3", "howItWorksStep4"] as const;

export function HowItWorksSection() {
  const t = useTranslations("home");

  return (
    <section id="how-it-works" className="py-16 md:py-24 lg:py-32 bg-[var(--color-bg-base)]">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              {t("howItWorksTag")}
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-normal font-serif-display text-[var(--color-text-primary)] mb-6">
              {t("howItWorksTitle")}
            </h2>
            <p className="text-lg text-[var(--color-text-secondary)] max-w-md mb-8">
              {t("howItWorksSubtitle")}
            </p>
            <Link href="/login">
              <Button className="bg-[var(--color-bg-inverted)] text-[var(--color-bg-raised)] hover:bg-[#4A2C2C] rounded-full">
                {t("startForFree")}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          <div className="relative space-y-0">
            <div className="absolute left-6 top-6 bottom-6 w-px bg-[var(--color-border-subtle)] hidden md:block" />
            {stepKeys.map((key, index) => {
              const Icon = stepIcons[index];
              const num = String(index + 1).padStart(2, "0");
              return (
                <div key={key} className="relative flex gap-6 md:gap-8 py-6">
                  <div className="relative z-10 flex-shrink-0 w-12 h-12 rounded-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] flex items-center justify-center text-lg font-semibold shadow-sm">
                    {num}
                  </div>
                  <div className="flex-1 pt-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4 text-[var(--color-text-secondary)]" />
                      <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t(`${key}Title`)}</h3>
                    </div>
                    <p className="text-[var(--color-text-secondary)] leading-relaxed">{t(`${key}Desc`)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
