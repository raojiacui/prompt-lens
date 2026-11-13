"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildRecreationPrompt } from "@/lib/workflow/recreation-prompt";

type Bundle = {
  project: { title: string; status: string };
  sceneVersions: Array<{ id: string; sceneIndex: number; generationPrompt: string; visual: Record<string, unknown>; metadata?: Record<string, unknown>; story?: { summary?: string } }>;
};

export function ProjectHistoryDetails({ projectId }: { projectId: string }) {
  const zh = useLocale() !== "en";
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setBundle(null); setError(""); setCopied(false);
    void (async () => {
      try {
        const response = await fetch(`/api/workflow/projects/${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!data.project || !Array.isArray(data.sceneVersions)) throw new Error();
        if (!controller.signal.aborted) setBundle(data);
      } catch { if (!controller.signal.aborted) setError(zh ? "分析详情暂时无法加载，请重试。" : "Unable to load analysis details. Please retry."); }
    })();
    return () => controller.abort();
  }, [projectId, attempt, zh]);
  const scenes = bundle?.sceneVersions || [];
  const prompts = scenes.map(scene => ({ scene, prompt: buildRecreationPrompt(scene) }));
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompts.filter(item => item.prompt).map(({ scene, prompt }) => `${zh ? "镜头" : "Shot"} ${scene.sceneIndex}\n${prompt}`).join("\n\n"));
      setCopied(true);
    } catch { setError(zh ? "复制失败，请选择提示词手动复制。" : "Copy failed. Select the prompt to copy it manually."); }
  }
  return <div className="min-w-0 space-y-4" aria-label={zh ? "分析结果详情" : "Analysis result details"}>
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/dashboard?tab=analyze&projectId=${encodeURIComponent(projectId)}`} className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-4">{zh ? "打开分析项目" : "Open analysis project"}</Link>
      {prompts.some(item => item.prompt) && <Button variant="outline" size="sm" onClick={() => void copy()}>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制全部提示词" : "Copy all prompts")}</Button>}
    </div>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(attempt + 1)}>{zh ? "重试" : "Retry"}</Button></div>}
    {!bundle && !error && <p role="status" className="text-sm text-muted-foreground">{zh ? "正在加载分析结果…" : "Loading analysis results…"}</p>}
    {bundle && <>
      <h3 className="break-words text-lg font-semibold">{bundle.project.title}</h3>
      {!scenes.length && <p className="text-sm text-muted-foreground">{bundle.project.status === "failed" ? (zh ? "该次分析失败，尚无可用提示词。" : "This analysis failed without a usable prompt.") : (zh ? "尚无已保存的镜头结果，可打开项目查看进度。" : "No saved shot results yet. Open the project to view progress.")}</p>}
      {prompts.map(({ scene, prompt }) => <article key={scene.id} className="min-w-0 space-y-2 rounded-xl border border-border p-4">
        <h4 className="font-medium">{zh ? "镜头" : "Shot"} {scene.sceneIndex}</h4>
        {scene.story?.summary && <p className="break-words text-sm text-muted-foreground">{scene.story.summary}</p>}
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{prompt || (zh ? "该镜头尚无可用提示词。" : "No usable prompt for this shot.")}</pre>
      </article>)}
    </>}
  </div>;
}
