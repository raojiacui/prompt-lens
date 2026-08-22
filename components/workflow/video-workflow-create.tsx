"use client";

import { useEffect, useRef, useState } from "react";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Copy, Link, Mic2, Play, RefreshCw, RotateCcw, Scissors, Upload, Video, WandSparkles } from "lucide-react";

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
};

type ModelOption = { id: string; displayName: string; family: string; provider: string; kieModelId: string; enabled: boolean; experimental?: boolean };
type ModelMode = "auto" | "manual";
type ModelPriority = "fast" | "balanced" | "best_quality" | "lowest_cost";

const MAX_ANALYSIS_VIDEO_SECONDS = 10;
const VIDEO_DURATION_TOLERANCE_SECONDS = 0.75;

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
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item !== "object" || item === null) return String(item);
        const record = item as Record<string, unknown>;
        const time = typeof record.start === "number" || typeof record.end === "number" ? `[${formatTime(Number(record.start || 0))}-${formatTime(Number(record.end || 0))}] ` : "";
        const speaker = record.speaker ? `${record.speaker}: ` : "";
        return `${time}${speaker}${record.text || record.summary || record.role || ""}`.trim();
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj.summary || obj.transcriptSummary || obj.ambience || obj.music || obj.role || obj.action || obj.beat || JSON.stringify(obj));
  }
  return String(value);
}

function pickField(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const next = textValue(record[key]);
    if (next) return next;
  }
  return "";
}

function getVideoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取视频时长，请换一个视频文件。"));
    };
    video.src = url;
  });
}
function isSupportedSharedVideoUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host.includes("youtu.be") || host.includes("tiktok.com") || host.includes("douyin.com") || host.includes("iesdouyin.com") || host.includes("amemv.com");
  } catch {
    return false;
  }
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
  const promptSaveTimersRef = useRef<Record<string, number>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "image" | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [title, setTitle] = useState("Untitled video project");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [rewritingSceneId, setRewritingSceneId] = useState("");
  const [retryingSceneId, setRetryingSceneId] = useState("");
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, string>>({});
  const [rewriteDrafts, setRewriteDrafts] = useState<Record<string, string>>({});
  const [selectedSceneVersionIds, setSelectedSceneVersionIds] = useState<Record<string, string>>({});
  const [copiedSceneVersionId, setCopiedSceneVersionId] = useState("");
  const [analysisModels, setAnalysisModels] = useState<ModelOption[]>([]);
  const [analysisModelValue, setAnalysisModelValue] = useState("auto");
  const modelPriority: ModelPriority = "balanced";

  useEffect(() => {
    void loadProjects();
    void loadModels();

    return () => {
      Object.values(promptSaveTimersRef.current).forEach(window.clearTimeout);
    };
  }, []);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    bundle?.allSceneVersions.forEach((scene) => {
      drafts[scene.id] = scene.generationPrompt;
    });
    setSceneDrafts(drafts);
  }, [bundle?.activeVersion?.id, bundle?.allSceneVersions]);
  const projectMediaType = bundle?.project.metadata?.mediaType === "image" ? "image" : "video";

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

  async function readJsonResponse(response: Response, fallback: string) {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || `${fallback} (${response.status})`);
    }
    return data;
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

  async function handleFile(nextFile: File) {
    const type = nextFile.type.startsWith("video/") ? "video" : nextFile.type.startsWith("image/") ? "image" : null;
    if (!type) {
      setError("请上传 10 秒以内的视频（也就是一个完整的镜头片段）或图片进行分析。");
      return;
    }

    if (type === "video") {
      try {
        const duration = await getVideoDuration(nextFile);
        if (duration > MAX_ANALYSIS_VIDEO_SECONDS + VIDEO_DURATION_TOLERANCE_SECONDS) {
          setError(`目前视频分析仅支持 ${MAX_ANALYSIS_VIDEO_SECONDS} 秒以内的视频（也就是一个完整的镜头片段）。当前文件读取到约 ${duration.toFixed(1)} 秒，请截取后再上传。图片不受此限制。`);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "无法读取视频时长，请换一个视频文件。");
        return;
      }
    }

    if (preview) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setMediaType(type);
    setPreview(URL.createObjectURL(nextFile));
    setTitle(nextFile.name.replace(/\.[^.]+$/, "") || (type === "image" ? "Image analysis" : "Video analysis"));
    setError("");
  }
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingUpload(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) void handleFile(droppedFile);
  }

  async function startBreakdown() {
    const urlMode = inputMode === "url";
    const directUrl = mediaUrlInput.trim();
    if (urlMode && !directUrl) return;
    if (urlMode && !isSupportedSharedVideoUrl(directUrl)) {
      setError("目前粘贴链接只支持 YouTube、TikTok、抖音的视频分享链接。");
      return;
    }
    if (!urlMode && (!file || !mediaType)) return;
    setLoading(true);
    setError("");
    setProgress(urlMode ? "解析 YouTube / TikTok / 抖音链接" : `Uploading reference ${mediaType} to R2`);
    try {
      const upload = urlMode
        ? { url: directUrl, filename: directUrl.split("/").pop() || "linked-video", key: undefined, mediaType: "video" as const }
        : await uploadMediaToBlob(file!, (percentage) => setProgress(`Uploading ${Math.round(percentage)}%`));
      setProgress("Creating project");
      const projectRes = await fetch("/api/workflow/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const projectData = await readJsonResponse(projectRes, "Project creation failed");

      setProgress(upload.mediaType === "image" ? "Analyzing image blueprint" : urlMode ? "解析视频并开始分析" : "Analyzing video blueprint");
      const breakdownRes = await fetch(`/api/workflow/projects/${projectData.project.id}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: upload.url, mediaName: upload.filename, storageKey: upload.key, mediaType: upload.mediaType, mediaDuration: urlMode ? undefined : mediaDuration, singleShot: !urlMode && Boolean(mediaDuration && mediaDuration <= MAX_ANALYSIS_VIDEO_SECONDS + VIDEO_DURATION_TOLERANCE_SECONDS), resolveLinkedMedia: urlMode, ...analysisSelectionPayload() }),
      });
      const breakdownData = await readJsonResponse(breakdownRes, "Breakdown failed");
      setBundle(breakdownData);
      await loadProjects();
      setProgress(upload.mediaType === "image" ? "Image Blueprint ready" : "Video Blueprint ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow failed";
      setError(message === "Failed to fetch" ? "网络请求失败：请检查上传服务、视频拆解服务或本地开发服务是否正常运行。" : message);
      setProgress("");
    } finally {
      setLoading(false);
    }
  }

  function updateSceneDraft(scene: SceneVersion, prompt: string) {
    setSceneDrafts((drafts) => ({ ...drafts, [scene.id]: prompt }));
    schedulePromptAutosave(scene, prompt);
  }

  function schedulePromptAutosave(scene: SceneVersion, prompt: string) {
    const existingTimer = promptSaveTimersRef.current[scene.id];
    if (existingTimer) window.clearTimeout(existingTimer);

    promptSaveTimersRef.current[scene.id] = window.setTimeout(() => {
      delete promptSaveTimersRef.current[scene.id];
      void savePrompt(scene, prompt);
    }, 800);
  }

  async function savePrompt(scene: SceneVersion, prompt: string) {
    if (!bundle) return;
    setError("");
    try {
      const response = await fetch(`/api/workflow/projects/${bundle.project.id}/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationPrompt: prompt || scene.generationPrompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Auto save failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto save failed");
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
      if (data.scene?.id && data.scene?.originalSceneId) {
        setSelectedSceneVersionIds((versions) => ({ ...versions, [data.scene.originalSceneId]: data.scene.id }));
      }
      setRewriteDrafts((drafts) => ({ ...drafts, [scene.id]: "" }));
      await loadProject(bundle.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewritingSceneId("");
    }
  }

  async function copySceneAnalysis(scene: SceneVersion) {
    const text = formatSceneAnalysis(scene, projectMediaType);
    await navigator.clipboard.writeText(text);
    setCopiedSceneVersionId(scene.id);
    window.setTimeout(() => setCopiedSceneVersionId((current) => (current === scene.id ? "" : current)), 1600);
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

  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">视频分析</h1>
          <p className="mt-2 max-w-5xl text-lg leading-relaxed text-muted-foreground">全新升级保姆级视频脚本拆解，从全方位多维度（可复用提示词，画面，角色，动作，光线、色彩、风格、镜头）对视频或者图片进行分析。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadProjects()}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.68fr_1.32fr]">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div
            className={cn(
              "rounded-2xl border border-dashed border-border bg-muted/30 p-3 transition-colors",
              isDraggingUpload && "border-primary/70 bg-primary/5",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingUpload(true);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDraggingUpload(true);
            }}
            onDragLeave={() => setIsDraggingUpload(false)}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" accept="video/*,image/*" className="sr-only" onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])} />
            {preview ? (
              mediaType === "image" ? (
                <img src={preview} alt="Preview" className="mb-3 max-h-56 w-full rounded-xl object-contain" />
              ) : (
                <video src={preview} muted playsInline controls className="mb-3 max-h-56 w-full rounded-xl bg-black object-contain" />
              )
            ) : null}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl bg-background text-center hover:bg-accent">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="font-semibold">{preview ? "更换文件" : "上传 10 秒以内的视频（也就是一个完整的镜头片段）或图片进行分析"}</span>
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setInputMode("file")} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors", inputMode === "file" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground")}>上传文件</button>
            <button type="button" onClick={() => setInputMode("url")} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors", inputMode === "url" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground")}>粘贴链接</button>
          </div>

          {inputMode === "url" ? (
            <label className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <Link className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="url"
                value={mediaUrlInput}
                onChange={(event) => {
                  setMediaUrlInput(event.target.value);
                  setFile(null);
                  setPreview("");
                  setMediaType("video");
                  setMediaDuration(null);
                }}
                placeholder="粘贴 YouTube / TikTok / 抖音视频分享链接"
                className="h-8 min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
          ) : null}

          {inputMode === "url" ? <p className="mt-2 text-xs text-muted-foreground">支持 YouTube、TikTok、抖音链接；链接会交给视频拆解 worker 解析，短视频直接分析，长视频进入分场景流程。</p> : null}

          <div className="mt-4">
            <ModelSelector
              label="Analysis model"
              value={analysisModelValue}
              models={analysisModels}
              onChange={setAnalysisModelValue}
            />
          </div>

          <button
            type="button"
            onClick={() => void startBreakdown()}
            disabled={(inputMode === "file" ? !file : !mediaUrlInput.trim()) || loading}
            className="mt-4 flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[#D97757] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#C96848] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? <Spinner size="sm" /> : <WandSparkles className="h-5 w-5" />}
            {loading ? "Analyzing..." : mediaType === "image" ? "Analyze Image" : "Analyze Video"}
          </button>

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
              <p className="font-medium">Video or image analysis workflow will appear here</p>
              <p className="text-sm text-muted-foreground">Upload a video or image to create the first editable scene blueprint.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{bundle.project.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Active version: {bundle.activeVersion?.label || "None"} · {bundle.scenes.length} scene{bundle.scenes.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {projectMediaType === "video" ? (
                    <>
                      <Button variant="outline" onClick={() => onNavigateTool?.("audio", { projectId: bundle.project.id, versionId: bundle.activeVersion?.id || "" })}>
                        <Mic2 className="mr-2 h-4 w-4" />Audio
                      </Button>
                      <Button variant="outline" onClick={() => onNavigateTool?.("edit", { projectId: bundle.project.id, versionId: bundle.activeVersion?.id || "" })}>
                        <Scissors className="mr-2 h-4 w-4" />Edit
                      </Button>
                    </>
                  ) : null}
                  <Button onClick={() => {
                    const firstScene = bundle.sceneVersions[0];
                    if (firstScene) onSendToGenerate({ prompt: sceneDrafts[firstScene.id] || firstScene.generationPrompt, projectId: bundle.project.id, sceneId: firstScene.originalSceneId, versionId: firstScene.projectVersionId, duration: projectMediaType === "image" ? undefined : firstScene.duration, modelId: undefined });
                    else onNavigateTool?.("video-gen");
                  }}>
                    <Video className="mr-2 h-4 w-4" />做同款
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <h3 className="font-semibold">Whole Video Overview</h3>
                <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-2 text-sm text-muted-foreground md:grid-cols-2">
                  {Object.entries(bundle.activeVersion?.overview || {}).map(([key, value]) => (
                    <p key={key}><span className="font-medium text-foreground">{key}: </span>{textValue(value)}</p>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                {bundle.sceneVersions.map((latestSceneVersion) => {
                  const sceneVersions = getSceneVersionHistory(bundle, latestSceneVersion);
                  const selectedSceneVersion = sceneVersions.find((version) => version.id === selectedSceneVersionIds[latestSceneVersion.originalSceneId]) || latestSceneVersion;
                  const sceneVersionIndex = Math.max(0, sceneVersions.findIndex((version) => version.id === selectedSceneVersion.id));
                  const sceneVersion = selectedSceneVersion;
                  const scene = bundle.scenes.find((item) => item.id === sceneVersion.originalSceneId);
                  const needsReview = scene?.status === "failed" || sceneVersion.metadata?.analysisProvider === "fallback";
                  return (
                    <article key={latestSceneVersion.originalSceneId} className="rounded-xl border border-border bg-background p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">Scene {String(sceneVersion.sceneIndex).padStart(2, "0")}</h3>
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", needsReview ? "bg-amber-500/15 text-amber-700" : "bg-emerald-500/15 text-emerald-700")}>{sceneStatusLabel(scene, sceneVersion)}</span>
                          </div>
                          {projectMediaType === "video" ? (
                            <p className="mt-1 text-sm text-muted-foreground">{formatTime(scene?.startTime || 0)} - {formatTime(scene?.endTime || sceneVersion.duration)} · {sceneVersion.duration.toFixed(1)}s</p>
                          ) : null}
                          {scene?.error ? <p className="mt-1 max-w-3xl text-xs text-amber-700">{scene.error}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void retryScene(sceneVersion)} disabled={retryingSceneId === sceneVersion.id}>
                            {retryingSceneId === sceneVersion.id ? <Spinner size="sm" className="mr-2" /> : <RotateCcw className="mr-2 h-4 w-4" />}Retry
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onSendToGenerate({ prompt: sceneDrafts[sceneVersion.id] || sceneVersion.generationPrompt, projectId: bundle.project.id, sceneId: sceneVersion.originalSceneId, versionId: sceneVersion.projectVersionId, duration: projectMediaType === "image" ? undefined : sceneVersion.duration, modelId: undefined })}>
                            <Video className="mr-2 h-4 w-4" />做同款
                          </Button>
                        </div>
                      </div>

                      {projectMediaType === "image" && scene?.keyframeUrls?.[0] ? (
                        <img src={scene.keyframeUrls[0]} alt="Analyzed" className="mt-3 max-h-64 w-full rounded-xl object-contain" />
                      ) : scene?.clipUrl ? (
                        <video src={scene.clipUrl} controls className="mt-3 max-h-64 w-full rounded-xl bg-black object-contain" />
                      ) : null}

                      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                        <div>
                          <label className="text-sm font-semibold">复刻 Prompt</label>
                          <Textarea
                            value={sceneDrafts[sceneVersion.id] ?? sceneVersion.generationPrompt}
                            onChange={(event) => updateSceneDraft(sceneVersion, event.target.value)}
                            className="mt-2 min-h-40 rounded-xl"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-semibold">AI 修改脚本</label>
                          <div className="relative mt-2">
                            <Textarea
                              value={rewriteDrafts[sceneVersion.id] || ""}
                              onChange={(event) => setRewriteDrafts((drafts) => ({ ...drafts, [sceneVersion.id]: event.target.value }))}
                              placeholder="Make this scene warmer and more comedic, but keep the same timing and camera move."
                              className="min-h-40 rounded-xl pb-14 pr-14"
                            />
                            <button
                              type="button"
                              aria-label="重写脚本"
                              onClick={() => void rewriteScene(sceneVersion)}
                              disabled={!rewriteDrafts[sceneVersion.id]?.trim() || rewritingSceneId === sceneVersion.id}
                              className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#D97757] text-white shadow-sm transition-colors hover:bg-[#C96848] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {rewritingSceneId === sceneVersion.id ? <Spinner size="sm" /> : <WandSparkles className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-sm font-semibold">分析拆解</label>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <button
                              type="button"
                              aria-label="复制分析拆解"
                              onClick={() => void copySceneAnalysis(sceneVersion)}
                              className="flex h-8 items-center gap-1 rounded-full border border-border bg-background px-3 transition-colors hover:bg-accent"
                            >
                              {copiedSceneVersionId === sceneVersion.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              <span>{copiedSceneVersionId === sceneVersion.id ? "Copied" : "Copy"}</span>
                            </button>
                            <button
                              type="button"
                              aria-label="上一版脚本"
                              disabled={sceneVersionIndex <= 0}
                              onClick={() => setSelectedSceneVersionIds((versions) => ({ ...versions, [latestSceneVersion.originalSceneId]: sceneVersions[sceneVersionIndex - 1].id }))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="min-w-14 text-center">{sceneVersionIndex + 1}/{sceneVersions.length}</span>
                            <button
                              type="button"
                              aria-label="下一版脚本"
                              disabled={sceneVersionIndex >= sceneVersions.length - 1}
                              onClick={() => setSelectedSceneVersionIds((versions) => ({ ...versions, [latestSceneVersion.originalSceneId]: sceneVersions[sceneVersionIndex + 1].id }))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <Textarea
                          readOnly
                          value={formatSceneAnalysis(sceneVersion, projectMediaType)}
                          className="mt-2 max-h-[420px] min-h-[300px] resize-y rounded-xl font-sans text-sm leading-7 text-muted-foreground"
                        />
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

function getSceneVersionHistory(bundle: Bundle, sceneVersion: SceneVersion) {
  return bundle.allSceneVersions
    .filter((version) => version.originalSceneId === sceneVersion.originalSceneId && version.projectVersionId === sceneVersion.projectVersionId)
    .sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB || a.id.localeCompare(b.id);
    });
}
function formatSceneAnalysis(sceneVersion: SceneVersion, mediaType: "video" | "image") {
  const sections: Array<[string, unknown]> = [
    ["画面复刻", pickField(sceneVersion.visual, ["sceneDescription", "subject", "environment"])],
    ["角色/动作", `${pickField(sceneVersion.visual, ["characters", "subject"])}\n${pickField(sceneVersion.visual, ["action", "motion"])}`.trim()],
    ["镜头语言", `${pickField(sceneVersion.visual, ["camera"])}\n${pickField(sceneVersion.visual, ["composition"])}`.trim()],
    ["光线/色彩/风格", `${pickField(sceneVersion.visual, ["lighting"])}\n${pickField(sceneVersion.visual, ["color"])}\n${pickField(sceneVersion.visual, ["style"])}`.trim()],
    ["剧情作用", sceneVersion.story],
  ];

  if (mediaType === "video") {
    sections.push(
      ["台词/字幕", sceneVersion.dialogue.length ? sceneVersion.dialogue : sceneVersion.subtitle],
      ["音频", sceneVersion.audio],
      ["剪辑提示", sceneVersion.transition],
    );
  }

  return sections
    .map(([title, value]) => `${title}\n${textValue(value) || "No detected data yet."}`)
    .join("\n\n");
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
          <option key={model.id} value={model.id}>
            {model.displayName}{model.provider === "openrouter" ? " · OpenRouter" : ""}{model.experimental ? " · Experimental" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
