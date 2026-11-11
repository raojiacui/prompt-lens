"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowUpRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { INFISTAR_REGISTRATION_URL } from "@/lib/ai/providers";

export function ProviderAnnouncement() {
  const t = useTranslations("home");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <aside aria-label={t("announcementLabel")} className="relative border-b border-orange-200/70 bg-[#FFF2E7] px-11 py-2.5 text-center text-xs leading-5 text-[#6D3924] sm:text-sm">
    <a href={INFISTAR_REGISTRATION_URL} target="_blank" rel="noopener noreferrer" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 hover:text-[#A94B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"><strong className="inline-flex items-center gap-2 whitespace-nowrap font-semibold"><span className="inline-flex items-center gap-1.5"><Image src="/prompt-lens-icon.png" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" />PromptLens</span><span>×</span><span className="inline-flex items-center gap-1.5"><Image src="/partners/infistar-logo.jpg" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 rounded-md object-contain" />Infistar</span></strong><span className="hidden sm:inline" aria-hidden="true">｜</span><span>{t("announcementOffer")}</span><span className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-4">{t("announcementRegister")}<ArrowUpRight size={14} /></span></a>
    <button type="button" aria-label={t("announcementClose")} onClick={() => setDismissed(true)} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md hover:bg-orange-200/50 focus-visible:outline focus-visible:outline-2"><X size={16} /></button>
  </aside>;
}
