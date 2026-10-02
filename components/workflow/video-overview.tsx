"use client";

import { useLocale } from "next-intl";
import { useId } from "react";
import { readableVideoOverview } from "@/lib/workflow/video-overview";

type Props = Parameters<typeof readableVideoOverview>;

export function VideoOverview({ overview, scenes, image = false }: { overview: Props[0]; scenes: Props[1]; image?: boolean }) {
  const zh = useLocale() === "zh";
  const headingId = useId();
  const result = readableVideoOverview(overview, scenes);
  if (!result.paragraphs.length && !result.style && !result.rhythm) return null;
  return (
    <section className="min-w-0 rounded-lg border border-border bg-background p-4">
      <h3 id={headingId} className="font-semibold">{image ? (zh ? "画面解读" : "Image interpretation") : (zh ? "整片解读" : "Video interpretation")}</h3>
      {result.partial && <p className="mt-2 text-xs text-amber-700">{zh ? "部分镜头分析未完成，以下仅包含已分析内容。" : "Some scenes are not analyzed. Only available analysis is included below."}</p>}
      <div role="region" aria-labelledby={headingId} tabIndex={0} className="mt-3 max-h-64 space-y-3 overflow-y-auto overscroll-contain break-words pr-3 text-sm leading-7 text-muted-foreground [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {result.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {result.style && <p><span className="font-medium text-foreground">{zh ? "画面风格：" : "Visual style: "}</span>{result.style}</p>}
        {!image && result.rhythm && <p><span className="font-medium text-foreground">{zh ? "剪辑节奏：" : "Editing rhythm: "}</span>{result.rhythm}</p>}
      </div>
    </section>
  );
}
