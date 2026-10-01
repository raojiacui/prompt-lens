"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, FileVideo, Image as ImageIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildRecreationPrompt } from "@/lib/workflow/recreation-prompt";
import { VideoOverview } from "@/components/workflow/video-overview";

type Project = { id: string; title: string; status: string; updatedAt: string; metadata?: Record<string, unknown> };
type Version = { id: string; label: string; versionNumber: number; kind: string; overview: Record<string, unknown> };
type Scene = { id: string; sceneIndex: number; startTime: number; endTime: number; duration: number; clipUrl?: string | null; keyframeUrls: string[]; status: string; error?: string | null };
type SceneVersion = {
  id: string;
  projectVersionId: string;
  originalSceneId: string;
  sceneIndex: number;
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  dialogue: unknown[];
  subtitle: unknown[];
  audio: Record<string, unknown>;
  transition: Record<string, unknown>;
  generationPrompt: string;
  duration: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};
type Bundle = {
  project: Project;
  versions: Version[];
  activeVersion: Version | null;
  scenes: Scene[];
  sceneVersions: SceneVersion[];
  allSceneVersions: SceneVersion[];
  referenceVideos: Array<{ sourceUrl: string; fileName?: string | null; duration?: number | null }>;
};

const sampleLabels = {
  zh: {
    copy: "复制",
    copied: "已复制",
    previousVersion: "上一版脚本",
    nextVersion: "下一版脚本",
    noDetectedData: "暂未检测到数据。",
    fallbackTitle: "AI 分析未完成",
    fallbackReason: "原因",
    fallbackUnavailable: "AI 分析服务暂不可用",
    fallbackAction: "当前没有生成可用的画面拆解或复刻 Prompt。",
    sections: {
      visual: "画面复刻",
      action: "角色/动作",
      camera: "镜头语言",
      style: "光线/色彩/风格",
      story: "剧情作用",
      dialogue: "台词/字幕",
      audio: "音频",
      edit: "剪辑提示",
    },
  },
  en: {
    copy: "Copy",
    copied: "Copied",
    previousVersion: "Previous version",
    nextVersion: "Next version",
    noDetectedData: "No detected data yet.",
    fallbackTitle: "AI analysis is incomplete",
    fallbackReason: "Reason",
    fallbackUnavailable: "AI analysis service is temporarily unavailable",
    fallbackAction: "No usable visual breakdown or recreatable prompt was generated.",
    sections: {
      visual: "Visual recreation",
      action: "Character / Action",
      camera: "Camera language",
      style: "Lighting / Color / Style",
      story: "Story purpose",
      dialogue: "Dialogue / Subtitles",
      audio: "Audio",
      edit: "Editing notes",
    },
  },
};
type SampleCopy = typeof sampleLabels.zh;

function sampleCopyFor(locale: string) {
  return locale === "en" ? sampleLabels.en : sampleLabels.zh;
}

export function SampleProjectDetail({ sampleId }: { sampleId: string }) {
  const locale = useLocale();
  const copy = sampleCopyFor(locale);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSceneVersionIndexes, setSelectedSceneVersionIndexes] = useState<Record<string, number>>({});
  const [copiedSceneVersionId, setCopiedSceneVersionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSample() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/samples/${sampleId}`, { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Failed to load sample");
        if (!cancelled) setBundle(data as Bundle);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load sample");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSample();
    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  async function copySceneAnalysis(sceneVersion: SceneVersion) {
    const text = buildRecreationPrompt(sceneVersion);
    await navigator.clipboard.writeText(text);
    setCopiedSceneVersionId(sceneVersion.id);
    window.setTimeout(() => setCopiedSceneVersionId(null), 1400);
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg-base)] px-5 pb-16 pt-24 text-[var(--color-text-primary)] md:px-10 lg:px-14">
      <div className="mx-auto max-w-[1480px]">
        <Link href="/samples" className="inline-flex items-center gap-2 text-base font-semibold text-[#B76442] transition-colors hover:text-[#8F4630]">
          <ArrowLeft className="h-5 w-5" />
          返回样例
        </Link>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Spinner />
          </div>
        ) : error || !bundle ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Sample not found"}</div>
        ) : (
          <ProjectBundleView
            bundle={bundle}
            copy={copy}
            selectedSceneVersionIndexes={selectedSceneVersionIndexes}
            setSelectedSceneVersionIndexes={setSelectedSceneVersionIndexes}
            copiedSceneVersionId={copiedSceneVersionId}
            copySceneAnalysis={copySceneAnalysis}
          />
        )}
      </div>
    </main>
  );
}

function ProjectBundleView({
  bundle,
  copy,
  selectedSceneVersionIndexes,
  setSelectedSceneVersionIndexes,
  copiedSceneVersionId,
  copySceneAnalysis,
}: {
  bundle: Bundle;
  copy: SampleCopy;
  selectedSceneVersionIndexes: Record<string, number>;
  setSelectedSceneVersionIndexes: Dispatch<SetStateAction<Record<string, number>>>;
  copiedSceneVersionId: string | null;
  copySceneAnalysis: (sceneVersion: SceneVersion) => void;
}) {
  const mediaType = projectMediaType(bundle);

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal md:text-5xl">{bundle.project.title}</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Active version: {bundle.activeVersion?.label || "None"} · {bundle.scenes.length} scene{bundle.scenes.length === 1 ? "" : "s"}
            </p>
          </div>
          <span className="rounded-full bg-[#F1E0D4] px-3 py-1 text-sm font-semibold text-[#8F4630]">公开视频样例</span>
        </div>

        {bundle.referenceVideos[0]?.sourceUrl ? (
          <video src={bundle.referenceVideos[0].sourceUrl} controls preload="metadata" className="mt-5 max-h-[560px] w-full rounded-lg bg-black object-contain" />
        ) : null}
      </section>

      <VideoOverview overview={bundle.activeVersion?.overview || {}} scenes={bundle.sceneVersions} image={mediaType === "image"} />

      <div className="grid gap-4">
        {bundle.sceneVersions.map((latestSceneVersion) => {
          const sceneVersions = getSceneVersionHistory(bundle, latestSceneVersion);
          const latestSceneVersionIndex = Math.max(0, sceneVersions.findIndex((version) => version.id === latestSceneVersion.id));
          const requestedSceneVersionIndex = selectedSceneVersionIndexes[latestSceneVersion.originalSceneId] ?? latestSceneVersionIndex;
          const sceneVersionIndex = clampIndex(requestedSceneVersionIndex, sceneVersions.length);
          const sceneVersion = sceneVersions[sceneVersionIndex] || latestSceneVersion;
          const scene = bundle.scenes.find((item) => item.id === sceneVersion.originalSceneId);
          const needsReview = scene?.status === "failed" || sceneVersion.metadata?.analysisProvider === "fallback";

          return (
            <article key={latestSceneVersion.originalSceneId} className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">Scene {String(sceneVersion.sceneIndex).padStart(2, "0")}</h3>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", needsReview ? "bg-amber-500/15 text-amber-700" : "bg-emerald-500/15 text-emerald-700")}>{sceneStatusLabel(scene, sceneVersion)}</span>
                  </div>
                  {mediaType === "video" ? (
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      {formatTime(scene?.startTime || 0)} - {formatTime(scene?.endTime || sceneVersion.duration)} · {sceneVersion.duration.toFixed(1)}s
                    </p>
                  ) : null}
                </div>
              </div>

              {mediaType === "image" && scene?.keyframeUrls?.[0] ? (
                <img src={scene.keyframeUrls[0]} alt="Analyzed" className="mt-3 max-h-64 w-full rounded-lg object-contain" />
              ) : scene?.clipUrl ? (
                <video src={scene.clipUrl} controls className="mt-3 max-h-64 w-full rounded-lg bg-black object-contain" />
              ) : (
                <div className="mt-3 flex h-48 items-center justify-center rounded-lg bg-[#E8DED2] text-[var(--color-text-muted)]">
                  {mediaType === "video" ? <FileVideo className="h-10 w-10" /> : <ImageIcon className="h-10 w-10" />}
                </div>
              )}

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`sample-prompt-${sceneVersion.id}`} className="text-sm font-semibold">完整复刻提示词</label>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <button
                      type="button"
                      aria-label={copy.copy}
                      title={copiedSceneVersionId === sceneVersion.id ? copy.copied : copy.copy}
                      onClick={() => copySceneAnalysis(sceneVersion)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-white transition-colors hover:bg-[var(--color-bg-base)]"
                    >
                      {copiedSceneVersionId === sceneVersion.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label={copy.previousVersion}
                      disabled={sceneVersionIndex <= 0}
                      onClick={() => setSelectedSceneVersionIndexes((indexes) => ({ ...indexes, [latestSceneVersion.originalSceneId]: sceneVersionIndex - 1 }))}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-white transition-colors hover:bg-[var(--color-bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-14 text-center">{sceneVersionIndex + 1} / {sceneVersions.length}</span>
                    <button
                      type="button"
                      aria-label={copy.nextVersion}
                      disabled={sceneVersionIndex >= sceneVersions.length - 1}
                      onClick={() => setSelectedSceneVersionIndexes((indexes) => ({ ...indexes, [latestSceneVersion.originalSceneId]: sceneVersionIndex + 1 }))}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-white transition-colors hover:bg-[var(--color-bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <Textarea id={`sample-prompt-${sceneVersion.id}`} readOnly value={buildRecreationPrompt(sceneVersion)} className="mt-2 min-h-[300px] resize-y rounded-lg font-sans text-sm leading-7" />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function projectMediaType(bundle: Bundle | null): "video" | "image" {
  return bundle?.project.metadata?.mediaType === "image" ? "image" : "video";
}

function getSceneVersionHistory(bundle: Bundle, sceneVersion: SceneVersion) {
  const versionNumberById = new Map(bundle.versions.map((version) => [version.id, version.versionNumber]));
  return bundle.allSceneVersions
    .filter((version) => version.originalSceneId === sceneVersion.originalSceneId)
    .sort((a, b) => {
      const versionA = versionNumberById.get(a.projectVersionId) ?? 0;
      const versionB = versionNumberById.get(b.projectVersionId) ?? 0;
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return versionA - versionB || timeA - timeB || a.id.localeCompare(b.id);
    });
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}


function formatTime(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, "0")}${tenths ? `.${tenths}` : ""}`;
}



function sceneStatusLabel(scene?: Scene, sceneVersion?: SceneVersion) {
  const provider = sceneVersion?.metadata?.analysisProvider;
  if (scene?.status === "failed") return provider === "fallback" ? "Needs review" : "Failed";
  if (scene?.status === "completed") return "Analyzed";
  if (scene?.status === "processing") return "Analyzing";
  return scene?.status || "Ready";
}
