"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { Menu, X, ChevronDown } from "lucide-react";

const LOCALE_DISPLAY: Record<Locale, { label: string }> = {
  zh: { label: "中文" },
  en: { label: "English" },
};

function LanguageDropdown() {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const switchTo = (next: Locale) => {
    if (next === locale) {
      setOpen(false);
      return;
    }
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setOpen(false);
    router.refresh();
  };

  return (
    <div ref={ref} className="relative group">
      <button
        type="button"
        aria-label="Switch language"
        aria-haspopup="menu"
        aria-expanded={open}
        className="text-base text-white/80 hover:text-blue-300 transition-colors"
      >
        {t("navLanguage")}
      </button>

      <div
        role="menu"
        className="absolute left-0 top-full pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
      >
        <div className="w-36 rounded-lg border border-white/15 bg-slate-900/70 backdrop-blur-md shadow-lg overflow-hidden">
          {(["zh", "en"] as Locale[]).map((loc) => {
            const display = LOCALE_DISPLAY[loc];
            const isActive = loc === locale;
            return (
              <button
                key={loc}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => switchTo(loc)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-white/15 text-white font-medium"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                )}
              >
                <span>{display.label}</span>
                {isActive && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const t = useTranslations("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "#features", label: t("navFeatures") },
    { href: "#pricing", label: t("navPricing") },
    { href: "#articles", label: t("navArticles") },
    { href: "#blog", label: t("navBlog") },
  ];

  return (
    <header className="absolute top-0 left-0 right-0 z-50 bg-transparent">
      <div className="w-full px-3 md:px-5 lg:px-6">
        <div className="flex items-center h-16 md:h-18">
          <Link href="/" className="flex items-center gap-3 group shrink-0" aria-label="Prompt Lens">
            <Image
              src="/prompt-lens-icon.png"
              alt="Prompt Lens"
              width={541}
              height={563}
              className="h-12 w-auto object-contain brightness-0 invert"
            />
            <span className="text-2xl font-semibold text-white tracking-tight">Prompt Lens</span>
          </Link>

          <nav className="hidden md:flex items-center gap-10 ml-10">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-base text-white/80 hover:text-blue-300 transition-colors"
              >
                {item.label}
              </a>
            ))}
            <LanguageDropdown />
          </nav>

          <div className="hidden md:flex items-center gap-4 ml-auto">
            <Link href="/login">
              <Button className="text-sm bg-white text-slate-900 hover:bg-white/90 rounded-full px-5">
                {t("signIn")}
              </Button>
            </Link>
          </div>

          <div className="md:hidden flex items-center gap-2 ml-auto">
            <button
              className="p-2 text-white"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-900/90 backdrop-blur-md border-t border-white/10 px-4 py-4 space-y-3">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block py-2 text-white/80 hover:text-blue-300"
              onClick={() => setMobileMenuOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="py-2">
            <LanguageDropdown />
          </div>
          <div className="pt-3 border-t border-white/10">
            <Link href="/login" className="block" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full bg-white text-slate-900 hover:bg-white/90 rounded-full">
                {t("signIn")}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
