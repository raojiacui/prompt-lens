"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { Menu, X, LayoutDashboard } from "lucide-react";

const LOCALE_DISPLAY: Record<Locale, { label: string }> = {
  zh: { label: "中文" },
  en: { label: "English" },
};

function LanguageDropdown({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isLight = variant === "light";

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
        className={cn(
          "text-base transition-colors",
          isLight ? "text-[var(--color-text-secondary)] hover:text-[#B76442]" : "text-white/80 hover:text-blue-300"
        )}
      >
        {t("navLanguage")}
      </button>

      <div
        role="menu"
        className="absolute left-0 top-full pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
      >
        <div className={cn(
          "w-36 overflow-hidden rounded-lg border backdrop-blur-md shadow-lg",
          isLight ? "border-[var(--color-border-default)] bg-white/95" : "border-white/15 bg-slate-900/70"
        )}>
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
                    ? isLight ? "bg-[#F1E0D4] text-[#8F4630] font-medium" : "bg-white/15 text-white font-medium"
                    : isLight ? "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]" : "text-white/80 hover:bg-white/10 hover:text-white"
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

export function SiteHeader({
  user,
  variant = "dark",
}: {
  user: { name?: string | null; image?: string | null; email?: string | null } | null;
  variant?: "dark" | "light";
}) {
  const t = useTranslations("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAuthenticated = !!user;
  const isLight = variant === "light";

  const navItems = [
    { href: "/#features", label: t("navFeatures") },
    { href: "/samples", label: t("navSamples") },
    { href: "/#pricing", label: t("navPricing") },
    { href: "/#articles", label: t("navArticles") },
    { href: "/#blog", label: t("navBlog") },
  ];

  return (
    <header className={cn("absolute top-0 left-0 right-0 z-50", isLight ? "border-b border-[var(--color-border-default)] bg-[var(--color-bg-base)]/90 backdrop-blur" : "bg-transparent")}>
      <div className="w-full px-3 md:px-5 lg:px-6">
        <div className="flex items-center h-16 md:h-18">
          <Link href="/" className="flex items-center gap-3 group shrink-0" aria-label="Prompt Lens">
            <Image
              src="/prompt-lens-icon.png"
              alt="Prompt Lens"
              width={541}
              height={563}
              className={cn("h-12 w-auto object-contain", !isLight && "brightness-0 invert")}
            />
            <span className={cn("text-2xl font-semibold tracking-tight", isLight ? "text-[var(--color-text-primary)]" : "text-white")}>Prompt Lens</span>
          </Link>

          <nav className="hidden md:flex items-center gap-10 ml-10">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-base transition-colors",
                  isLight ? "text-[var(--color-text-secondary)] hover:text-[#B76442]" : "text-white/80 hover:text-blue-300"
                )}
              >
                {item.label}
              </Link>
            ))}
            <LanguageDropdown variant={variant} />
          </nav>

          <div className="hidden md:flex items-center gap-4 ml-auto">
            {isAuthenticated ? (
              <>
                <Link href="/dashboard">
                  <Button className={cn("rounded-full px-5 text-sm", isLight ? "bg-[#B76442] text-white hover:bg-[#8F4630]" : "bg-white text-slate-900 hover:bg-white/90")}>
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    {t("dashboard") || "Dashboard"}
                  </Button>
                </Link>
              </>
            ) : (
              <Link href="/login">
                <Button className={cn("rounded-full px-5 text-sm", isLight ? "bg-[#B76442] text-white hover:bg-[#8F4630]" : "bg-white text-slate-900 hover:bg-white/90")}>
                  {t("signIn")}
                </Button>
              </Link>
            )}
          </div>

          <div className="md:hidden flex items-center gap-2 ml-auto">
            <button
              className={cn("p-2", isLight ? "text-[var(--color-text-primary)]" : "text-white")}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className={cn("space-y-3 px-4 py-4 backdrop-blur-md md:hidden", isLight ? "border-t border-[var(--color-border-default)] bg-white/95" : "border-t border-white/10 bg-slate-900/90")}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn("block py-2", isLight ? "text-[var(--color-text-secondary)] hover:text-[#B76442]" : "text-white/80 hover:text-blue-300")}
              onClick={() => setMobileMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <div className="py-2">
            <LanguageDropdown variant={variant} />
          </div>
          <div className={cn("border-t pt-3", isLight ? "border-[var(--color-border-default)]" : "border-white/10")}>
            {isAuthenticated ? (
              <Link href="/dashboard" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button className={cn("w-full rounded-full", isLight ? "bg-[#B76442] text-white hover:bg-[#8F4630]" : "bg-white text-slate-900 hover:bg-white/90")}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  {t("dashboard") || "Dashboard"}
                </Button>
              </Link>
            ) : (
              <Link href="/login" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button className={cn("w-full rounded-full", isLight ? "bg-[#B76442] text-white hover:bg-[#8F4630]" : "bg-white text-slate-900 hover:bg-white/90")}>
                  {t("signIn")}
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
