"use client";

import { useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { INFISTAR_REGISTRATION_URL, INFISTAR_ANNOUNCEMENT_COOKIE } from "@/lib/ai/providers";

export function ProviderAnnouncement({ initiallyDismissed = false }: { initiallyDismissed?: boolean }) {
  const t = useTranslations("home");
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  if (dismissed) return null;
  return <aside aria-label={t("announcementLabel")} className="relative border-b border-orange-200/70 bg-[#FFF2E7] px-11 py-2.5 text-center text-xs leading-5 text-[#6D3924] sm:text-sm">
    <a href={INFISTAR_REGISTRATION_URL} target="_blank" rel="noopener noreferrer" className="inline-flex flex-wrap items-center justify-center gap-x-2 hover:text-[#A94B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"><strong className="font-semibold">PromptLens × Infistar</strong><span className="hidden sm:inline" aria-hidden="true">｜</span><span>{t("announcementOffer")}</span><span className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-4">{t("announcementRegister")}<ArrowUpRight size={14} /></span></a>
    <button type="button" aria-label={t("announcementClose")} onClick={() => {
      document.cookie = `${INFISTAR_ANNOUNCEMENT_COOKIE}=closed; Path=/; Max-Age=2592000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      setDismissed(true);
    }} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md hover:bg-orange-200/50 focus-visible:outline focus-visible:outline-2"><X size={16} /></button>
  </aside>;
}
