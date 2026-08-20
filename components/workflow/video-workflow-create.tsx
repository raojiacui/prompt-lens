"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GitCompare, Mic2, Play, RefreshCw, RotateCcw, Save, Scissors, Upload, Video, WandSparkles } from "lucide-react";

type Project = { id: string; title: string; status: string; updatedAt: string; activeVersionId?: string | null; metadata?: Record<string, unknown> };
type Version = { id: string; label: string; versionNumber: number; kind: string; overview: Record<string, unknown>; remixPrompt?: string | null };
type Scene = { id: string; sceneIndex: number; startTime: number; endTime: number; duration: number; clipUrl?: string | null; keyframeUrls: string[]; status: string; error?: string | null };
type SceneVersion = {
  id: string;
  projectVersionId: string;
  originalSceneId: string;
  sceneIndex: number;
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  audio: Record<string, unknown>;
  transition: Record<string, unknown>;
  generationPrompt: string;
  duration: number;
  metadata?: Record<string, unknown>;
};
type Bundle = {
  project: Project;
  versions: Version[];
  activeVersion: Version | null;
  scenes: Scene[];
  sceneVersions: SceneVersion[];
  allSceneVersions: SceneVersion[];
};

type ModelOption = { id: string; displayName: string; family: string; kieModelId: string; enabled: boolean; experimental?: boolean };
type ModelMode = "auto" | "manual";
type ModelPriority = "fast" | "balanced" | "best_quality" | "lowest_cost";

type Props = {
  onSendToGenerate: (payload: { prompt: string; projectId: string; sceneId: string; versionId: string; duration?: number; modelId?: string }) => void;
  onNavigateTool?: (tab: "video-gen" | "audio" | "edit", payload?: Record<string, string>) => void;
};

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, "0")}${tenths ? `.${tenths}` : ""}`;
}

function textValue(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj.summary || obj.role || obj.action || obj.beat || JSON.stringify(obj));
  }
  return String(value);
}

function sceneStatusLabel(scene?: Scene, sceneVersion?: SceneVersion) {
  const provider = sceneVersion?.metadata?.analysisProvider;
  if (scene?.status === "failed") return provider === "fallback" ? "Needs review" : "Failed";
  if (scene?.status === "completed") return "Analyzed";
  if (scene?.status === "processing") return "Analyzing";
  return scene?.status || "Ready";
}

export function VideoWorkflowCreate({ onSendToGenerate, onNavigateTool }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [title, setTitle] = useState("Untitled video project");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingSceneId, setSavingSceneId] = useState("");
  const [rewritingSceneId, setRewritingSceneId] = useState("");
  const [retryingSceneId, setRetryingSceneId] = useState("");
  const [remixPrompt, setRemixPrompt] = useState("");
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, string>>({});
  const [rewriteDrafts, setRewriteDrafts] = useState<Record<string, string>>({});
  const [compareOpen, setCompareOpen] = useState(false);
  const [analysisModels, setAnalysisModels] = useState<ModelOption[]>([]);
  const [analysisModelValue, setAnalysisModelValue] = useState("auto");
  const modelPriority: ModelPriority = "balanced";

  useEffect(() => {
    void loadProjects();
    void loadModels();
  }, []);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    bundle?.sceneVersions.forEach((scene) => {
      drafts[scene.id] = scene.generationPrompt;
    });
    setSceneDrafts(drafts);
  }, [bundle?.activeVersion?.id]);

  const originalVersion = bundle?.versions.find((version) => version.kind === "original") || null;
  const remixVersions = bundle?.versions.filter((version) => version.kind === "remix") || [];
  const latestRemix = remixVersions[remixVersions.length - 1] || null;
  const originalScenes = useMemo(
    () => bundle?.allSceneVersions.filter((scene) => scene.projectVersionId === originalVersion?.id).sort((a, b) => a.sceneIndex - b.sceneIndex) || [],
    [bundle?.allSceneVersions, originalVersion?.id],
  );
  const remixScenes = useMemo(
    () => bundle?.allSceneVersions.filter((scene) => scene.projectVersionId === latestRemix?.id).sort((a, b) => a.sceneIndex - b.sceneIndex) || [],
    [bundle?.allSceneVersions, latestRemix?.id],
  );

  async function loadProjects() {
    const response = await fetch("/api/workflow/projects");
    const data = await response.json();
    setProjects(data.projects || []);
  }

  async function loadModels() {
    const response = await fetch("/api/models?category=analysis");
    const data = await response.json();
    const nextAnalysisModels = Array.isArray(data.models) ? data.models.filter((model: ModelOption) => model.enabled) : [];
    setAnalysisModels(nextAnalysisModels);
  }

  function analysisSelectionPayload() {
    const manualModelId = analysisModelValue === "auto" ? "" : analysisModelValue;
    return {
      modelMode: manualModelId ? "manual" as ModelMode : "auto" as ModelMode,
      modelId: manualModelId || undefined,
      modelPriority,
    };
  }

  async function loadProject(projectId: string) {
    setError("");
    const response = await fetch(`/api/workflow/projects/${projectId}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Failed to load project");
      return;
    }
    setBundle(data);
  }

  function handleFile(nextFile: File) {
    if (!nextFile.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setTitle(nextFile.name.replace(/\.[^.]+$/, "") || "Video analysis");
    setError("");
  }

  async function startBreakdown() {
    if (!file) return;
    setLoading(true);
    setError("");
    setProgress("Uploading reference video to R2");
    try {
      const upload = await uploadMediaToBlob(file, (percentage) => setProgress(`Uploading ${Math.round(percentage)}%`));
      setProgress("Creating project");
      const projectRes = await fetch("/api/workflow/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const projectData = await projectRes.json();
      if (!projectRes.ok) throw new Error(projectData.error || "Project creation failed");

      setProgress("Detecting scenes and building Video Blueprint");
      const breakdownRes = await fetch(`/api/workflow/projects/${projectData.project.id}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: upload.url, mediaName: upload.filename, storageKey: upload.key, ...analysisSelectionPayload() }),
      });
      const breakdownData = await breakdownRes.json();
      if (!breakdownRes.ok) throw new Error(breakdownData.error || "Video breakdown failed");
      setBundle(breakdownData);
      await loadProjects();
      setProgress("Video Blueprint ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workflow failed");
      setProgress("");
    } finally {
      setLoading(false);
    }
  }

  async function savePrompt(scene: SceneVersion) {
    if (!bundle) return;
    setSavingSceneId(scene.id);
    setError("");
    try {
      const response = await fetch(`/api/workflow/projects/${bundle.project.id}/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationPrompt: sceneDrafts[scene.id] || scene.generationPrompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed");
      await loadProject(bundle.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingSceneId("");
    }
  }

  async function rewriteScene(scene: SceneVersion) {
    if (!bundle) return;
    const instruction = rewriteDrafts[scene.id]?.trim();
    if (!instruction) return;
    setRewritingSceneId(scene.id);
    setError("");
    try {
      const response = await fetch(`/api/workflow/projects/${bundle.project.id}/scenes/${scene.id}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, ...analysisSelectionPayload() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rewrite failed");
      setRewriteDrafts((drafts) => ({ ...drafts, [scene.id]: "" }));
      await loadProject(bundle.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewritingSceneId("");
    }
  }

  async function retryScene(scene: SceneVersion) {
    if (!bundle) return;
    setRetryingSceneId(scene.id);
    setError("");
    try {
      const response = await fetch(`/api/workflow/projects/${bundle.project.id}/scenes/${scene.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysisSelectionPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Retry failed");
      await loadProject(bundle.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingSceneId("");
    }
  }

  async function createRemix() {
    if (!bundle?.activeVersion || !remixPrompt.trim()) return;
    setLoading(true);
    setProgress("Creating remix version");
    setError("");
    try {
      const response = await fetch(`/api/workflow/projects/${bundle.project.id}/remix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceVersionId: bundle.activeVersion.id, remixPrompt, ...analysisSelectionPayload() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Remix failed");
      setBundle(data);
      setRemixPrompt("");
      setCompareOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remix failed");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">视频分析</h1>
          <p className="mt-2 text-lg text-muted-foreground">拆解参考视频，生成场景脚本、提示词和后续工作流。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadProjects()}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.68fr_1.32fr]">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-3">
            <input ref={fileInputRef} type="file" accept="video/*" className="sr-only" onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
            {preview ? <video src={preview} muted playsInline controls className="mb-3 max-h-56 w-full rounded-xl bg-black object-contain" /> : null}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl bg-background text-center hover:bg-accent">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="font-semibold">Upload video for analysis</span>
              <span className="text-sm text-muted-foreground">Scene breakdown, KIE analysis, remix, and generation handoff</span>
            </button>
          </div>

          <div className="mt-4">
            <ModelSelector
              label="Analysis model"
              value={analysisModelValue}
              models={analysisModels}
              onChange={setAnalysisModelValue}
            />
          </div>


          <label className="mt-4 grid gap-2 text-sm font-medium">
            Rewrite instruction
            <Textarea
              value={remixPrompt}
              onChange={(event) => setRemixPrompt(event.target.value)}
              placeholder="把橘猫换成狸花猫，保留原来的镜头结构、节奏和笑点，重新创造一版完整脚本"
              className="min-h-28 rounded-xl"
            />
          </label>
          {bundle?.activeVersion ? (
            <Button onClick={() => void createRemix()} disabled={!remixPrompt.trim() || loading} variant="outline" className="mt-3 w-full rounded-xl">
              {loading ? <Spinner size="sm" className="mr-2" /> : <WandSparkles className="mr-2 h-4 w-4" />}
              Create New Script
            </Button>
          ) : null}
          <Button onClick={() => void startBreakdown()} disabled={!file || loading} className="mt-4 w-full rounded-xl bg-[#D97757] text-white hover:bg-[#C96848] disabled:!opacity-100 disabled:bg-[#DCA28E] disabled:text-white">
            {loading ? <Spinner size="sm" className="mr-2" /> : <WandSparkles className="mr-2 h-4 w-4" />}
            Analyze Video
          </Button>

          {progress ? <p className="mt-3 text-sm text-muted-foreground">{progress}</p> : null}
          {error ? <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <div className="mt-6 border-t border-border pt-4">
            <h2 className="font-semibold">Projects</h2>
            <div className="mt-3 grid gap-2">
              {projects.map((project) => (
                <button key={project.id} type="button" onClick={() => void loadProject(project.id)} className={cn("rounded-xl border px-3 py-2 text-left text-sm hover:border-primary/50", bundle?.project.id === project.id ? "border-primary bg-primary/10" : "border-border bg-background")}>
                  <span className="block font-medium">{project.title}</span>
                  <span className="text-xs text-muted-foreground">{project.status}</span>
                </button>
              ))}
              {!projects.length ? <p className="text-sm text-muted-foreground">No projects yet.</p> : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {!bundle ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
              <Play className="mb-4 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">Video analysis workflow will appear here</p>
              <p className="text-sm text-muted-foreground">Upload a video to create the first editable scene blueprint.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{bundle.project.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Active version: {bundle.activeVersion?.label || "None"} · {bundle.scenes.length} scene{bundle.scenes.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setCompareOpen((open) => !open)} disabled={!latestRemix}>
                    <GitCompare className="mr-2 h-4 w-4" />Compare
                  </Button>
                  <Button variant="outline" onClick={() => onNavigateTool?.("audio", { projectId: bundle.project.id, versionId: bundle.activeVersion?.id || "" })}>
                    <Mic2 className="mr-2 h-4 w-4" />Audio
                  </Button>
                  <Button variant="outline" onClick={() => onNavigateTool?.("edit", { projectId: bundle.project.id, versionId: bundle.activeVersion?.id || "" })}>
                    <Scissors className="mr-2 h-4 w-4" />Edit
                  </Button>
                  <Button onClick={() => {
                    const firstScene = bundle.sceneVersions[0];
                    if (firstScene) onSendToGenerate({ prompt: sceneDrafts[firstScene.id] || firstScene.generationPrompt, projectId: bundle.project.id, sceneId: firstScene.originalSceneId, versionId: firstScene.projectVersionId, duration: firstScene.duration, modelId: undefined });
                    else onNavigateTool?.("video-gen");
                  }}>
                    <Video className="mr-2 h-4 w-4" />Open Generate
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <h3 className="font-semibold">Whole Video Overview</h3>
                <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                  {Object.entries(bundle.activeVersion?.overview || {}).map(([key, value]) => (
                    <p key={key}><span className="font-medium text-foreground">{key}: </span>{textValue(value)}</p>
                  ))}
                </div>
              </div>\n{compareOpen && latestRemix ? (
                <div className="rounded-xl border border-border bg-background p-4">
                  <h3 className="font-semibold">Original vs {latestRemix.label}</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Original</p>
                      {originalScenes.map((scene) => <SceneMini key={scene.id} scene={scene} />)}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{latestRemix.label}</p>
                      {remixScenes.map((scene) => <SceneMini key={scene.id} scene={scene} />)}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4">
                {bundle.sceneVersions.map((sceneVersion) => {
                  const scene = bundle.scenes.find((item) => item.id === sceneVersion.originalSceneId);
                  const needsReview = scene?.status === "failed" || sceneVersion.metadata?.analysisProvider === "fallback";
                  return (
                    <article key={sceneVersion.id} className="rounded-xl border border-border bg-background p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">Scene {String(sceneVersion.sceneIndex).padStart(2, "0")}</h3>
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", needsReview ? "bg-amber-500/15 text-amber-700" : "bg-emerald-500/15 text-emerald-700")}>{sceneStatusLabel(scene, sceneVersion)}</span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{formatTime(scene?.startTime || 0)} - {formatTime(scene?.endTime || sceneVersion.duration)} · {sceneVersion.duration.toFixed(1)}s</p>
                          {scene?.error ? <p className="mt-1 max-w-3xl text-xs text-amber-700">{scene.error}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void retryScene(sceneVersion)} disabled={retryingSceneId === sceneVersion.id}>
                            {retryingSceneId === sceneVersion.id ? <Spinner size="sm" className="mr-2" /> : <RotateCcw className="mr-2 h-4 w-4" />}Retry
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onSendToGenerate({ prompt: sceneDrafts[sceneVersion.id] || sceneVersion.generationPrompt, projectId: bundle.project.id, sceneId: sceneVersion.originalSceneId, versionId: sceneVersion.projectVersionId, duration: sceneVersion.duration, modelId: undefined })}>
                            <Video className="mr-2 h-4 w-4" />Open in Generate
                          </Button>
                        </div>
                      </div>

                      {scene?.clipUrl ? <video src={scene.clipUrl} controls className="mt-3 max-h-64 w-full rounded-xl bg-black object-contain" /> : null}

                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <InfoPanel title="Story" value={sceneVersion.story} />
                        <InfoPanel title="Visual" value={sceneVersion.visual} />
                        <InfoPanel title="Audio" value={sceneVersion.audio} />
                        <InfoPanel title="Transition" value={sceneVersion.transition} />
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                        <div>
                          <label className="text-sm font-semibold">Generation Prompt</label>
                          <Textarea value={sceneDrafts[sceneVersion.id] ?? sceneVersion.generationPrompt} onChange={(event) => setSceneDrafts((drafts) => ({ ...drafts, [sceneVersion.id]: event.target.value }))} className="mt-2 min-h-32 rounded-xl" />
                          <Button size="sm" onClick={() => void savePrompt(sceneVersion)} disabled={savingSceneId === sceneVersion.id} className="mt-3">
                            {savingSceneId === sceneVersion.id ? <Spinner size="sm" className="mr-2" /> : <Save className="mr-2 h-4 w-4" />}Save
                          </Button>
                        </div>
                        <div>
                          <label className="text-sm font-semibold">AI Rewrite</label>
                          <Textarea value={rewriteDrafts[sceneVersion.id] || ""} onChange={(event) => setRewriteDrafts((drafts) => ({ ...drafts, [sceneVersion.id]: event.target.value }))} placeholder="Make this scene warmer and more comedic, but keep the same timing and camera move." className="mt-2 min-h-32 rounded-xl" />
                          <Button size="sm" variant="outline" onClick={() => void rewriteScene(sceneVersion)} disabled={!rewriteDrafts[sceneVersion.id]?.trim() || rewritingSceneId === sceneVersion.id} className="mt-3">
                            {rewritingSceneId === sceneVersion.id ? <Spinner size="sm" className="mr-2" /> : <WandSparkles className="mr-2 h-4 w-4" />}Rewrite Scene
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoPanel({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 line-clamp-5 text-xs leading-relaxed text-muted-foreground">{textValue(value)}</p>
    </div>
  );
}

function SceneMini({ scene }: { scene: SceneVersion }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
      <p className="font-medium">Scene {String(scene.sceneIndex).padStart(2, "0")}</p>
      <p className="mt-1 line-clamp-3 text-muted-foreground">{scene.generationPrompt}</p>
    </div>
  );
}

function ModelSelector({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: ModelOption[];
  onChange: (modelId: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
      >
        <option value="auto">Auto · Balanced</option>
        {models.map((model) => (
          <option key={model.id} value={model.kieModelId}>
            {model.displayName}{model.experimental ? " · Experimental" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
