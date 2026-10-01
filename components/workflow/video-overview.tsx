"use client";

import { useLocale } from "next-intl";
import { readableVideoOverview } from "@/lib/workflow/video-overview";

type Props = Parameters<typeof readableVideoOverview>;

export function VideoOverview({ overview, scenes, image = false }: { overview: Props[0]; scenes: Props[1]; image?: boolean }) {
  const zh = useLocale() === "zh";
  const result = readableVideoOverview(overview, scenes);
  if (!result.paragraphs.length && !result.style && !result.rhythm) return null;
  return (
    <section className="min-w-0 border-y border-border py-4">
      <h3 className="font-semibold">{image ? (zh ? "画面解读" : "Image interpretation") : (zh ? "整片解读" : "Video interpretation")}</h3>
      {result.partial && <p className="mt-2 text-xs text-amber-700">{zh ? "部分镜头分析未完成，以下仅包含已分析内容。" : "Some scenes are not analyzed. Only available analysis is included below."}</p>}
      <div className="mt-3 space-y-3 break-words text-sm leading-7 text-muted-foreground">
        {result.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {result.style && <p><span className="font-medium text-foreground">{zh ? "画面风格：" : "Visual style: "}</span>{result.style}</p>}
        {!image && result.rhythm && <p><span className="font-medium text-foreground">{zh ? "剪辑节奏：" : "Editing rhythm: "}</span>{result.rhythm}</p>}
      </div>
    </section>
  );
}
