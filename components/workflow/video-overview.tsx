"use client";

import { useLocale } from "next-intl";
import { useId } from "react";
import { readableVideoOverview } from "@/lib/workflow/video-overview";
import { FullVideoScriptPanel } from "./full-video-script-panel";

type Props = Parameters<typeof readableVideoOverview>;

export function VideoOverview({ overview, scenes, image = false, script }: { overview: Props[0]; scenes: Props[1]; image?: boolean;
  script?: Omit<Parameters<typeof FullVideoScriptPanel>[0], "language" | "preview" | "partial">;
}) {
  const zh = useLocale() === "zh";
  const headingId = useId();
  const result = readableVideoOverview(overview, scenes);
  if (!result.paragraphs.length && !result.style && !result.rhythm && !script) return null;
  const content = <div className="space-y-3">
    {result.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {result.style && <p><span className="font-medium text-foreground">{zh ? "画面风格：" : "Visual style: "}</span>{result.style}</p>}
    {!image && result.rhythm && <p><span className="font-medium text-foreground">{zh ? "剪辑节奏：" : "Editing rhythm: "}</span>{result.rhythm}</p>}
  </div>;
  return (
    <section className="min-w-0 rounded-lg border border-border bg-background p-4">
      <h3 id={headingId} className="font-semibold">{image ? (zh ? "画面解读" : "Image interpretation") : (zh ? "整片解读" : "Video interpretation")}</h3>
      {script && !image ? <FullVideoScriptPanel {...script} language={zh ? "zh" : "en"} preview={content} partial={result.partial} /> : <>
        {result.partial && <p className="mt-2 text-xs text-amber-700">{zh ? "部分镜头分析未完成，以下仅包含已分析内容。" : "Some scenes are not analyzed. Only available analysis is included below."}</p>}
        <div role="region" aria-labelledby={headingId} className="mt-3 break-words text-sm leading-7 text-muted-foreground">{content}</div>
      </>}
    </section>
  );
}
