"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Film, Wand2, Mic2, Scissors, ArrowRight } from "lucide-react";

const featureIcons = [Film, Wand2, Mic2, Scissors];
const featureKeys = ["featureAnalyze", "featureGen", "featureAudio", "featureEdit"] as const;
const tabMap = ["analyze", "videoGen", "audio", "edit"];
const demoVideos = [
  "/feature-video-analysis.mp4",
  "/feature-video-generation.mp4",
  "/feature-audio-recognition.mp4",
  "/feature-video-edit.mp4",
];

function FeatureDemoVideo({ label, src }: { label: string; src: string }) {
  return (
    <div className="relative w-full aspect-[4/3] rounded-2xl bg-[#EDE5D8] border border-[var(--color-border-subtle)] overflow-hidden shadow-sm">
      <video
        src={src}
        aria-label={label}
        className="h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
    </div>
  );
}

export function FeaturesSection() {
  const t = useTranslations("home");

  return (
    <section id="features" className="py-16 md:py-24 lg:py-32 bg-[var(--color-bg-base)]">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="space-y-24 md:space-y-32">
          {featureKeys.map((key, index) => {
            const Icon = featureIcons[index];
            const isReversed = index % 2 === 1;
            const tag = t(`${key}Tag`);
            const title = t(`${key}Title`);
            const desc = t(`${key}Desc`);

            return (
              <div
                key={key}
                className={`flex flex-col lg:flex-row items-center gap-12 lg:gap-20 ${
                  isReversed ? "lg:flex-row-reverse" : ""
                }`}
              >
                <div className="flex-1 w-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-[#EDE5D8] text-[var(--color-text-secondary)] flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">{tag}</span>
                  </div>
                  <h3 className="text-3xl md:text-4xl font-normal font-serif-display text-[var(--color-text-primary)] mb-4">{title}</h3>
                  <p className="text-base md:text-lg text-[var(--color-text-secondary)] leading-relaxed mb-6">
                    {desc}
                  </p>
                  <ul className="space-y-3 mb-8">
                    {[1, 2, 3].map((i) => (
                      <li key={i} className="flex items-start gap-3 text-[var(--color-text-secondary)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] mt-2" />
                        <span>{t(`${key}Bullet${i}`)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href={`/dashboard?tab=${tabMap[index]}`}>
                    <Button variant="outline" className="rounded-full border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[#F5EDE2]">
                      {t("startForFree")}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
                <div className="flex-1 w-full">
                  <FeatureDemoVideo label={title} src={demoVideos[index]} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}