"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Copy, Play, RotateCcw, Trash2, Upload, Video, WandSparkles, X } from "lucide-react";

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
type AnalysisProgressPhase = "upload" | "project" | "analysis" | "complete";
type AnalysisProgressState = {
  phase: AnalysisProgressPhase;
  percent: number;
  label: string;
  detail: string;
};
type CreditStatus = {
  balance: number;
  mode: "admin" | "byok" | "platform_credits" | "trial";
  hasPaidVideoAnalysis?: boolean;
  trial: { limit: number; used: number; remaining: number; isAdmin: boolean };
  capabilities?: {
    videoAnalysis?: {
      shortVideoMaxSeconds: number;
      durationToleranceSeconds: number;
      canUseLongVideo: boolean;
      longVideoRequiresPayment: boolean;
      longVideoBaseCredits: number;
      perSceneCredits: number;
    };
  };
};

const MAX_ANALYSIS_VIDEO_SECONDS = 10;
const VIDEO_DURATION_TOLERANCE_SECONDS = 0.75;

type Props = {
  onSendToGenerate: (payload: { prompt: string; projectId: string; sceneId: string; versionId: string; duration?: number; modelId?: string; hiddenReferenceImageUrl?: string }) => void;
};

const projectsCacheKey = "prompt-lens-workflow-projects";

function cachedProjects() {
  try {
    const raw = window.localStorage.getItem(projectsCacheKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

function cacheProjects(projects: Project[]) {
  try {
    window.localStorage.setItem(projectsCacheKey, JSON.stringify(projects));
  } catch {}
}

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
function canUseLongVideo(status: CreditStatus | null) {
  return status?.mode === "admin" || status?.trial.isAdmin || status?.capabilities?.videoAnalysis?.canUseLongVideo === true;
}

function shortVideoLimitSeconds(status: CreditStatus | null) {
  const caps = status?.capabilities?.videoAnalysis;
  return (caps?.shortVideoMaxSeconds ?? MAX_ANALYSIS_VIDEO_SECONDS) + (caps?.durationToleranceSeconds ?? VIDEO_DURATION_TOLERANCE_SECONDS);
}

function sceneStatusLabel(scene?: Scene, sceneVersion?: SceneVersion) {
  const provider = sceneVersion?.metadata?.analysisProvider;
  if (scene?.status === "failed") return provider === "fallback" ? "Needs review" : "Failed";
  if (scene?.status === "completed") return "Analyzed";
  if (scene?.status === "processing") return "Analyzing";
  return scene?.status || "Ready";
}

const analysisProgressSteps: Array<{ phase: AnalysisProgressPhase; label: string; percent: number }> = [
  { phase: "upload", label: "上传素材", percent: 45 },
  { phase: "project", label: "创建项目", percent: 60 },
  { phase: "analysis", label: "AI 拆解分析", percent: 95 },
  { phase: "complete", label: "生成蓝图", percent: 100 },
];

function AnalysisProgressPanel({ progress }: { progress: AnalysisProgressState }) {
  const currentStepIndex = Math.max(0, analysisProgressSteps.findIndex((step) => step.phase === progress.phase));

  return (
    <div className="flex min-h-[520px] flex-col justify-center">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-background p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#D97757]">分析进度</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">{progress.label}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{progress.detail}</p>
          </div>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#D97757]/10 text-xl font-semibold text-[#D97757]">
            {progress.percent}%
          </div>
        </div>

        <div className="mt-6">
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[#D97757] shadow-[0_0_18px_rgba(217,119,87,0.35)] transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {analysisProgressSteps.map((step, index) => {
            const isDone = index < currentStepIndex || progress.phase === "complete";
            const isActive = step.phase === progress.phase && progress.phase !== "complete";
            return (
              <div
                key={step.phase}
                className={cn(
                  "rounded-xl border px-3 py-3",
                  isDone || isActive ? "border-[#D97757]/30 bg-[#D97757]/10" : "border-border bg-card"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-xs font-semibold", isDone || isActive ? "text-[#D97757]" : "text-muted-foreground")}>
                    {step.label}
                  </span>
                  {isDone ? <Check className="h-4 w-4 text-[#D97757]" /> : isActive ? <Spinner size="sm" /> : null}
                </div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{step.percent}%</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function VideoWorkflowCreate({ onSendToGenerate }: Props) {
  const locale = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptSaveTimersRef = useRef<Record<string, number>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "image" | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("Untitled video project");
  const [progress, setProgress] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [rewritingSceneId, setRewritingSceneId] = useState("");
  const [retryingSceneId, setRetryingSceneId] = useState("");
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, string>>({});
  const [rewriteDrafts, setRewriteDrafts] = useState<Record<string, string>>({});
  const [selectedSceneVersionIds, setSelectedSceneVersionIds] = useState<Record<string, string>>({});
  const [copiedSceneVersionId, setCopiedSceneVersionId] = useState("");
  const [analysisModels, setAnalysisModels] = useState<ModelOption[]>([]);
  const [analysisModelValue, setAnalysisModelValue] = useState("auto");
  const [analysisOutputLanguage, setAnalysisOutputLanguage] = useState<"zh" | "en">(locale === "en" ? "en" : "zh");
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const modelPriority: ModelPriority = "balanced";
  const canUploadLongVideo = canUseLongVideo(creditStatus);

  useEffect(() => {
    const cached = cachedProjects();
    if (cached.length) setProjects(cached);
    void loadProjects();
    void loadModels();
    void loadCreditStatus();

    return () => {
      Object.values(promptSaveTimersRef.current).forEach(window.clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!loading || !analysisProgress || analysisProgress.phase !== "analysis") return;

    const timer = window.setInterval(() => {
      setAnalysisProgress((current) => {
        if (!current || current.phase !== "analysis") return current;
        return {
          ...current,
          percent: Math.min(94, current.percent + 1),
          detail: current.detail,
        };
      });
    }, 900);

    return () => window.clearInterval(timer);
  }, [analysisProgress, loading]);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    bundle?.allSceneVersions.forEach((scene) => {
      drafts[scene.id] = scene.generationPrompt;
    });
    setSceneDrafts(drafts);
  }, [bundle?.activeVersion?.id, bundle?.allSceneVersions]);
  const projectMediaType = bundle?.project.metadata?.mediaType === "image" ? "image" : "video";

  async function loadProjects(options: { force?: boolean } = {}) {
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/workflow/projects?limit=20", {
        cache: options.force ? "no-store" : "default",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to load projects");
      const nextProjects = Array.isArray(data?.projects) ? data.projects : [];
      setProjects(nextProjects);
      cacheProjects(nextProjects);
    } catch (err) {
      if (!projects.length) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      }
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadCreditStatus() {
    const response = await fetch("/api/credits/me", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data) return null;
    const status = data as CreditStatus;
    setCreditStatus(status);
    return status;
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
      outputLanguage: analysisOutputLanguage,
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

  async function handleDeleteProject(projectId: string) {
    const response = await fetch(`/api/workflow/projects/${projectId}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Failed to delete project");
  }

  async function handleFile(nextFile: File) {
    const type = nextFile.type.startsWith("video/") ? "video" : nextFile.type.startsWith("image/") ? "image" : null;
    if (!type) {
      setError("请上传视频或图片进行分析。免费体验和未付费账号仅支持 10 秒以内完整镜头片段。");
      return;
    }

    let duration: number | null = null;
    if (type === "video") {
      try {
        duration = await getVideoDuration(nextFile);
        const shortLimit = shortVideoLimitSeconds(creditStatus);
        if (duration > shortLimit) {
          const latestStatus = await loadCreditStatus() || creditStatus;
          if (!canUseLongVideo(latestStatus)) {
            setError(`免费体验和未付费账号仅支持 ${MAX_ANALYSIS_VIDEO_SECONDS} 秒以内的视频（也就是一个完整的镜头片段）。当前文件读取到约 ${duration.toFixed(1)} 秒；升级后可上传长视频自动拆镜分析。`);
            return;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "无法读取视频时长，请换一个视频文件。");
        return;
      }
    }

    setMediaDuration(duration);

    if (preview) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setMediaType(type);
    setPreview(URL.createObjectURL(nextFile));
    setTitle(nextFile.name.replace(/\.[^.]+$/, "") || (type === "image" ? "Image analysis" : "Video analysis"));
    setAnalysisProgress(null);
    setError("");
  }

  function clearSelectedMedia() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setMediaType(null);
    setMediaDuration(null);
    setPreview("");
    setProgress("");
    setAnalysisProgress(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingUpload(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) void handleFile(droppedFile);
  }

  async function startBreakdown() {
    if (!file || !mediaType) return;
    setLoading(true);
    setError("");
    const mediaLabel = mediaType === "image" ? "图片" : "视频";
    setProgress(`Uploading reference ${mediaType} to R2`);
    setAnalysisProgress({
      phase: "upload",
      percent: 5,
      label: "上传素材",
      detail: `正在上传${mediaLabel}到存储服务`,
    });
    try {
      const upload = await uploadMediaToBlob(file, (percentage) => {
        const uploadPercent = Math.round(percentage);
        setProgress(`Uploading ${uploadPercent}%`);
        setAnalysisProgress({
          phase: "upload",
          percent: Math.max(5, Math.min(45, Math.round(uploadPercent * 0.45))),
          label: "上传素材",
          detail: `正在上传${mediaLabel} ${uploadPercent}%`,
        });
      });
      setProgress("Creating project");
      setAnalysisProgress({
        phase: "project",
        percent: 55,
        label: "创建项目",
        detail: "正在创建可编辑的视频分析项目",
      });
      const projectRes = await fetch("/api/workflow/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const projectData = await readJsonResponse(projectRes, "Project creation failed");

      setProgress(upload.mediaType === "image" ? "Analyzing image blueprint" : "Analyzing video blueprint");
      setAnalysisProgress({
        phase: "analysis",
        percent: 68,
        label: upload.mediaType === "image" ? "AI 图片分析" : "AI 视频拆解分析",
        detail: upload.mediaType === "image" ? "正在提取画面结构和复刻提示词" : "正在拆解镜头、画面、动作、光线和复刻提示词",
      });
      const breakdownRes = await fetch(`/api/workflow/projects/${projectData.project.id}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: upload.url, mediaName: upload.filename, storageKey: upload.key, mediaType: upload.mediaType, mediaDuration, singleShot: Boolean(mediaDuration && mediaDuration <= MAX_ANALYSIS_VIDEO_SECONDS + VIDEO_DURATION_TOLERANCE_SECONDS), ...analysisSelectionPayload() }),
      });
      const breakdownData = await readJsonResponse(breakdownRes, "Breakdown failed");
      setAnalysisProgress({
        phase: "complete",
        percent: 100,
        label: "生成蓝图",
        detail: "分析完成，正在展示结果",
      });
      setBundle(breakdownData);
      if (breakdownData.project) {
        setProjects((current) => {
          const nextProjects = [
            breakdownData.project as Project,
            ...current.filter((project) => project.id !== breakdownData.project.id),
          ].slice(0, 20);
          cacheProjects(nextProjects);
          return nextProjects;
        });
      }
      void loadProjects({ force: true });
      void loadCreditStatus();
      setProgress(upload.mediaType === "image" ? "Image Blueprint ready" : "Video Blueprint ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow failed";
      setError(message === "Failed to fetch" ? "网络请求失败：请检查上传服务、视频拆解服务或本地开发服务是否正常运行。" : message);
      setProgress("");
      setAnalysisProgress(null);
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
      await loadCreditStatus();
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
      await loadCreditStatus();
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

      </div>

      <div className="grid gap-4 xl:h-[calc(100vh-8rem)] xl:min-h-[680px] xl:grid-cols-[0.68fr_1.32fr]">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
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
              <div className="relative mb-3">
                {mediaType === "image" ? (
                  <img src={preview} alt="Preview" className="max-h-56 w-full rounded-xl object-contain" />
                ) : (
                  <video src={preview} muted playsInline controls className="max-h-56 w-full rounded-xl bg-black object-contain" />
                )}
                <button
                  type="button"
                  aria-label="删除已上传素材"
                  onClick={clearSelectedMedia}
                  disabled={loading}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl bg-background text-center hover:bg-accent">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="font-semibold">{preview ? "更换文件" : canUploadLongVideo ? "上传视频或图片进行分析" : "上传 10 秒以内的视频（也就是一个完整的镜头片段）或图片进行分析"}</span>
            </button>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{canUploadLongVideo ? "已解锁长视频自动拆镜分析。" : "免费体验和未付费账号仅支持 10 秒以内完整镜头片段；购买积分包后可上传几分钟长视频并自动拆镜分析。"}</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ModelSelector
              label="Analysis model"
              value={analysisModelValue}
              models={analysisModels}
              onChange={setAnalysisModelValue}
            />
            <LanguageSelector
              value={analysisOutputLanguage}
              onChange={setAnalysisOutputLanguage}
            />
          </div>

          <button
            type="button"
            onClick={() => void startBreakdown()}
            disabled={!file || loading}
            className="mt-4 flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[#D97757] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#C96848] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? <Spinner size="sm" /> : <WandSparkles className="h-5 w-5" />}
            {loading ? "Analyzing..." : mediaType === "image" ? "Analyze Image" : "Analyze Video"}
          </button>

          {progress ? <p className="mt-3 text-sm text-muted-foreground">{progress}</p> : null}
          {error ? <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <div className="mt-6 min-h-0 border-t border-border pt-4 xl:flex-1 xl:overflow-y-auto xl:pr-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Projects</h2>
              {projectsLoading ? <Spinner size="sm" /> : null}
            </div>
            <div className="mt-3 grid gap-2">
              {projects.map((project) => (
                <div key={project.id} className={cn("group flex items-center justify-between rounded-xl border px-3 py-2 text-sm hover:border-primary/50", bundle?.project.id === project.id ? "border-primary bg-primary/10" : "border-border bg-background")}>
                  <button type="button" onClick={() => void loadProject(project.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium">{project.title}</span>
                    <span className="text-xs text-muted-foreground">{project.status}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="删除项目"
                    onClick={() => {
                      if (!confirm("确定要删除这个项目吗？此操作无法撤销。")) return;
                      void (async () => {
                        try {
                          await handleDeleteProject(project.id);
                          if (bundle?.project.id === project.id) setBundle(null);
                          await loadProjects({ force: true });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to delete project");
                        }
                      })();
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {!projects.length ? <p className="text-sm text-muted-foreground">No projects yet.</p> : null}
            </div>
          </div>
        </section>

        <div className="relative min-h-0">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
          {!bundle ? (
            loading && analysisProgress ? (
              <AnalysisProgressPanel progress={analysisProgress} />
            ) : (
              <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                <Play className="mb-4 h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Video or image analysis workflow will appear here</p>
                <p className="text-sm text-muted-foreground">Upload a video or image to create the first editable scene blueprint.</p>
              </div>
            )
          ) : (
            <div className="space-y-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{bundle.project.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Active version: {bundle.activeVersion?.label || "None"} · {bundle.scenes.length} scene{bundle.scenes.length === 1 ? "" : "s"}</p>
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
                          <Button size="sm" variant="outline" onClick={() => onSendToGenerate({ prompt: sceneDrafts[sceneVersion.id] || sceneVersion.generationPrompt, projectId: bundle.project.id, sceneId: sceneVersion.originalSceneId, versionId: sceneVersion.projectVersionId, duration: projectMediaType === "image" ? undefined : sceneVersion.duration, modelId: undefined, hiddenReferenceImageUrl: scene?.keyframeUrls?.[0] })}>
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
  if (sceneVersion.metadata?.analysisProvider === "fallback") {
    const reason = textValue(sceneVersion.metadata?.fallbackReason) || "AI 分析服务暂不可用";
    return `AI 分析未完成\n原因：${reason}\n\n当前没有生成可用的画面拆解或复刻 Prompt。请检查 KIE API Key / BYOK_ENCRYPTION_KEY / 平台分析 Key 配置后，点击该镜头的 Retry 重新分析。`;
  }

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

function LanguageSelector({
  value,
  onChange,
}: {
  value: "zh" | "en";
  onChange: (language: "zh" | "en") => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      输出语言
      <select
        value={value}
        onChange={(event) => onChange(event.target.value === "en" ? "en" : "zh")}
        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
      >
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>
    </label>
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
          <option key={model.id} value={model.id}>
            {model.displayName}{model.provider === "openrouter" ? " · OpenRouter" : ""}{model.experimental ? " · Experimental" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
