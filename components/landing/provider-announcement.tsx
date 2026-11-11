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
  return <aside aria-label={t("announcementLabel")} className="relative border-b border-[#5B8193] bg-[#587F92] bg-cover bg-center px-11 py-2.5 text-center text-xs leading-5 text-white sm:text-sm" style={{ backgroundImage: "linear-gradient(rgba(18,48,66,0.25), rgba(18,48,66,0.25)), url('/partners/announcement-blue-texture.png')" }}>
    <a href={INFISTAR_REGISTRATION_URL} target="_blank" rel="noopener noreferrer" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80"><strong className="inline-flex items-center gap-2 whitespace-nowrap font-semibold"><span className="inline-flex items-center gap-1.5"><Image src="/prompt-lens-icon.png" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" />PromptLens</span><span>×</span><span className="inline-flex items-center gap-1.5"><Image src="/partners/infistar-logo.jpg" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 rounded-md object-contain" />Infistar</span></strong><span className="hidden sm:inline" aria-hidden="true">｜</span><span>{t("announcementOffer")}</span><span className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-4">{t("announcementRegister")}<ArrowUpRight size={14} /></span></a>
    <button type="button" aria-label={t("announcementClose")} onClick={() => setDismissed(true)} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/80"><X size={16} /></button>
  </aside>;
}
