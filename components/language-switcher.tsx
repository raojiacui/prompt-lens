"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

const LOCALE_DISPLAY: Record<Locale, { short: string; label: string }> = {
  zh: { short: "中", label: "中文" },
  en: { short: "EN", label: "English" },
};

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
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
    // 写入 cookie（与 next-intl 默认 cookie 名一致）
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setOpen(false);
    // 刷新服务端组件，应用新 locale
    router.refresh();
  };

  const current = LOCALE_DISPLAY[locale] ?? LOCALE_DISPLAY.zh;
  const other: Locale = locale === "zh" ? "en" : "zh";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch language"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 md:h-9 px-2.5 md:px-3 rounded-lg",
          "border border-[#C8C4BC] bg-transparent text-[#6B6860]",
          "hover:bg-[#F5F3EC] hover:text-[#D97757] hover:border-[#D97757]",
          "text-xs md:text-sm font-medium transition-all"
        )}
      >
        {/* 简洁的地球图标 */}
        <svg className="w-3.5 md:w-4 h-3.5 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
        <span className="font-semibold">{current.short}</span>
        <svg className={cn("w-3 h-3 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-36 rounded-lg border border-[#D8D5CC] bg-white shadow-lg overflow-hidden z-50"
        >
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
                    ? "bg-[#D97757]/10 text-[#D97757] font-medium"
                    : "text-[#141413] hover:bg-[#F5F3EC]"
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
      )}
    </div>
  );
}
