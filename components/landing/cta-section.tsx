"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

export function CTASection() {
  const t = useTranslations("home");

  return (
    <section className="relative min-h-[360px] md:min-h-[420px] flex items-center justify-center overflow-hidden">
      {/* 背景图 */}
      <Image
        src="/images/cta-text-fishing.jpg"
        alt="PromptLens CTA background"
        fill
        className="object-cover object-[center_65%]"
        sizes="100vw"
      />

      {/* 内容 */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 md:px-6 lg:px-8 text-center py-16">
        <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-normal font-serif-display text-white mb-6 whitespace-nowrap" style={{ textShadow: '0 2px 24px rgba(0,0,0,0.4)' }}>
          {t("ctaTitle")}
        </h2>
        <p className="text-lg text-white/85 max-w-2xl mx-auto mb-10" style={{ textShadow: '0 1px 12px rgba(0,0,0,0.4)' }}>
          {t("ctaSubtitle")}
        </p>
        <div className="flex items-center justify-center">
          <Link href="/login">
            <Button className="bg-white text-slate-900 hover:bg-white/90 rounded-full px-8 h-12 text-base font-medium group">
              {t("ctaPrimary")}
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
