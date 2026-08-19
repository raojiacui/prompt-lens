"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

export function HeroSection() {
  const t = useTranslations("home");

  return (
    <section className="relative overflow-hidden">
      {/* 背景图 - 完整显示，不裁剪 */}
      <img
        src="/images/hero-text-fishing.jpg"
        alt="PromptLens hero background"
        className="w-full h-auto block"
      />

      {/* 内容 */}
      <div className="absolute inset-0 flex flex-col items-center justify-start pt-40 md:pt-48 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-normal font-serif-display text-white leading-[1.1] mb-6 animate-fade-in" style={{ animationDelay: "80ms", textShadow: '0 2px 30px rgba(0,0,0,0.45)' }}>
          {t("heroTitle")}
        </h1>

        <p className="text-lg md:text-xl text-white max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in" style={{ animationDelay: "160ms", textShadow: '0 1px 16px rgba(0,0,0,0.5)' }}>
          {t("heroSubtitle")}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: "240ms" }}>
          <Link href="/login">
            <Button className="bg-white text-slate-900 hover:bg-white/90 rounded-full px-8 h-12 text-base font-medium group shadow-lg shadow-black/20">
              {t("heroCtaPrimary")}
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <Link href="#demo">
            <Button variant="outline" className="rounded-full border-white/40 text-white hover:bg-white/15 hover:text-white hover:border-white/50 px-8 h-12 text-base backdrop-blur-sm bg-black/15 shadow-lg shadow-black/15">
              {t("heroCtaSecondary")}
            </Button>
          </Link>
        </div>
      </div>
      </div>
    </section>
  );
}
