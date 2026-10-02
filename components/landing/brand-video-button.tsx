"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

export function BrandVideoButton({ className }: { className?: string }) {
  const t = useTranslations("home");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mounted]);

  function close() {
    videoRef.current?.pause();
    dialogRef.current?.close();
    setMounted(false);
  }

  return <>
    <button type="button" className={className} onClick={() => {
      setFailed(false);
      setMounted(true);
    }}>{t("navVideo")}</button>
    {mounted && createPortal(
      <dialog
        ref={element => {
          dialogRef.current = element;
          if (element && !element.open) element.showModal();
        }}
        aria-label={t("brandVideoTitle")}
        onCancel={event => { event.preventDefault(); close(); }}
        onClick={event => { if (event.target === event.currentTarget) close(); }}
        className="fixed inset-0 m-auto h-[100dvh] max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-white backdrop:bg-black/85 sm:p-8"
      >
        <div className="pointer-events-none flex h-full items-center justify-center">
          <div className="pointer-events-auto relative w-full max-w-6xl">
            <button type="button" onClick={close} aria-label={t("closeVideo")} title={t("closeVideo")} autoFocus className="absolute -top-12 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
            <video ref={videoRef} src={process.env.NEXT_PUBLIC_BRAND_VIDEO_URL || "/brand-video/prompt-lens-final.mp4"} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)} className="max-h-[calc(100dvh-8rem)] w-full rounded-lg bg-black object-contain" />
            {failed && <p role="alert" className="mt-3 text-center text-sm">{t("videoUnavailable")}</p>}
          </div>
        </div>
      </dialog>, document.body
    )}
  </>;
}
