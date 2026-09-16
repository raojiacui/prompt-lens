"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { AnalysisQuoteDialog } from "@/components/payments/analysis-quote-dialog";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Copy, Play, Trash2, Upload, Video, WandSparkles, X } from "lucide-react";

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
  commercialConsumptionEnabled?: boolean;
  balance: number;
  hasUserKieKey?: boolean;
  commercial?: { enabled: boolean; credits?: number; rewrites?: number; heldRewrites?: number };
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
const workflowLabels = {
  zh: {
    copy: "复制",
    copied: "已复制",
    previousVersion: "上一版脚本",
    nextVersion: "下一版脚本",
    noDetectedData: "暂未检测到数据。",
    fallbackTitle: "AI 分析未完成",
    fallbackReason: "原因",
    fallbackUnavailable: "AI 分析服务暂不可用",
    fallbackAction: "当前没有生成可用的画面拆解或复刻 Prompt。请检查 KIE API Key / BYOK_ENCRYPTION_KEY / 平台分析 Key 配置。",
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
    fallbackAction: "No usable visual breakdown or recreatable prompt was generated. Check KIE API Key / BYOK_ENCRYPTION_KEY / platform analysis key settings.",
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

function workflowCopyFor(locale: string) {
  return locale === "en" ? workflowLabels.en : workflowLabels.zh;
}

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

function shouldAttachHiddenReferenceImage(sceneVersion: SceneVersion, promptDraft: string) {
  const metadata = sceneVersion.metadata || {};
  const versionKind = typeof metadata.versionKind === "string" ? metadata.versionKind : "";
  const hasScriptRewrite =
    versionKind === "rewrite" ||
    typeof metadata.rewriteInstruction === "string" ||
    typeof metadata.previousSceneVersionId === "string" ||
    typeof metadata.remixPrompt === "string" ||
    typeof metadata.sourceSceneVersionId === "string";
  if (hasScriptRewrite) return false;

  return promptDraft.trim() === sceneVersion.generationPrompt.trim();
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
    const recognizedBgm = obj.recognizedBgm && typeof obj.recognizedBgm === "object" ? obj.recognizedBgm as Record<string, unknown> : null;
    if (recognizedBgm) {
      const title = typeof recognizedBgm.title === "string" ? recognizedBgm.title : "";
      const artist = typeof recognizedBgm.artist === "string" ? recognizedBgm.artist : "";
      const status = typeof recognizedBgm.status === "string" ? recognizedBgm.status : "";
      const song = [title, artist].filter(Boolean).join(" - ");
      const link = typeof recognizedBgm.songLink === "string" ? recognizedBgm.songLink : typeof recognizedBgm.spotifyUrl === "string" ? recognizedBgm.spotifyUrl : typeof recognizedBgm.appleMusicUrl === "string" ? recognizedBgm.appleMusicUrl : "";
      const summary = typeof obj.recognizedBgmSummary === "string" ? obj.recognizedBgmSummary : "";
      return [song || summary || `BGM recognition: ${status}`, link].filter(Boolean).join("\n");
    }
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
  const copy = workflowCopyFor(locale);
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
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, string>>({});
  const [rewriteDrafts, setRewriteDrafts] = useState<Record<string, string>>({});
  const [selectedSceneVersionIndexes, setSelectedSceneVersionIndexes] = useState<Record<string, number>>({});
  const [copiedSceneVersionId, setCopiedSceneVersionId] = useState("");
  const [analysisModels, setAnalysisModels] = useState<ModelOption[]>([]);
  const [analysisModelValue, setAnalysisModelValue] = useState("auto");
  const [analysisOutputLanguage, setAnalysisOutputLanguage] = useState<"zh" | "en">(locale === "en" ? "en" : "zh");
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [commercialSource, setCommercialSource] = useState<{ projectId: string; mediaUrl: string; mediaName: string; outputLanguage: "zh" | "en" } | null>(null);
  const [rewritePayer, setRewritePayer] = useState<"included" | "byok">("included");
  const rewriteRequestsRef = useRef<Record<string, { fingerprint: string; id: string }>>({});
  const rewriteBusyRef = useRef(false);
  const modelPriority: ModelPriority = "balanced";
  const canUploadLongVideo = creditStatus?.commercialConsumptionEnabled || canUseLongVideo(creditStatus);

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

  function rewriteSelectionPayload() {
    const manualModelId = analysisModelValue === "auto" ? "" : analysisModelValue;
    return {
      modelMode: manualModelId ? "manual" as ModelMode : "auto" as ModelMode,
      modelId: manualModelId || undefined,
      modelPriority: manualModelId ? modelPriority : "best_quality" as ModelPriority,
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
          if (!latestStatus?.commercialConsumptionEnabled && !canUseLongVideo(latestStatus)) {
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
      if (creditStatus?.commercialConsumptionEnabled && upload.mediaType === "video") {
        setCommercialSource({ projectId: projectData.project.id, mediaUrl: upload.url, mediaName: upload.filename, outputLanguage: analysisOutputLanguage });
        setAnalysisProgress(null);
        return;
      }

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
    if (!bundle || rewriteBusyRef.current) return;
    const instruction = rewriteDrafts[scene.id]?.trim();
    if (!instruction) return;
    rewriteBusyRef.current = true;
    setRewritingSceneId(scene.id);
    setError("");
    try {
      const payload = { instruction, currentPrompt: sceneDrafts[scene.id] ?? scene.generationPrompt, ...rewriteSelectionPayload(), ...(creditStatus?.commercial?.enabled ? { payer: rewritePayer } : {}) };
      const fingerprint = JSON.stringify(payload);
      const pendingStorageKey = `promptlens:rewrite:${bundle.project.id}:${scene.id}`;
      try { const saved = JSON.parse(localStorage.getItem(pendingStorageKey) || "null"); if (saved?.fingerprint === fingerprint && typeof saved.id === "string") rewriteRequestsRef.current[scene.id] = saved; } catch { /* Storage may be unavailable. */ }
      if (rewriteRequestsRef.current[scene.id]?.fingerprint !== fingerprint) rewriteRequestsRef.current[scene.id] = { fingerprint, id: crypto.randomUUID() };
      try { localStorage.setItem(pendingStorageKey, JSON.stringify(rewriteRequestsRef.current[scene.id])); } catch { /* Keep the in-memory request. */ }
      const response = await fetch(`/api/workflow/projects/${bundle.project.id}/scenes/${scene.id}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: rewriteRequestsRef.current[scene.id].id }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.final === true) { delete rewriteRequestsRef.current[scene.id]; try { localStorage.removeItem(pendingStorageKey); } catch {} }
        throw new Error(data.error || "Rewrite failed");
      }
      delete rewriteRequestsRef.current[scene.id];
      try { localStorage.removeItem(pendingStorageKey); } catch {}
      if (data.scene?.id && data.scene?.originalSceneId) {
        setSelectedSceneVersionIndexes((indexes) => ({ ...indexes, [data.scene.originalSceneId]: Number.MAX_SAFE_INTEGER }));
      }
      setRewriteDrafts((drafts) => ({ ...drafts, [scene.id]: "" }));
      await loadCreditStatus();
      await loadProject(bundle.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      rewriteBusyRef.current = false;
      setRewritingSceneId("");
    }
  }

  async function copySceneAnalysis(scene: SceneVersion) {
    const text = formatSceneAnalysis(scene, projectMediaType, copy);
    await navigator.clipboard.writeText(text);
    setCopiedSceneVersionId(scene.id);
    window.setTimeout(() => setCopiedSceneVersionId((current) => (current === scene.id ? "" : current)), 1600);
  }
  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
      {commercialSource && <AnalysisQuoteDialog source={commercialSource} onClose={() => setCommercialSource(null)} onComplete={(result) => { setBundle(result as Bundle); setCommercialSource(null); void loadCreditStatus(); void loadProjects({ force: true }); }} />}
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
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{creditStatus?.commercialConsumptionEnabled ? (locale === "zh" ? "视频最多60秒、100MB、20个镜头。确认报价后开始分析。" : "Up to 60 seconds, 100MB and 20 shots. Analysis starts after quote confirmation.") : canUploadLongVideo ? "已解锁长视频自动拆镜分析。" : "免费体验和未付费账号仅支持 10 秒以内完整镜头片段；购买积分包后可上传几分钟长视频并自动拆镜分析。"}</p>
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
                  const latestSceneVersionIndex = Math.max(0, sceneVersions.findIndex((version) => version.id === latestSceneVersion.id));
                  const requestedSceneVersionIndex = selectedSceneVersionIndexes[latestSceneVersion.originalSceneId] ?? latestSceneVersionIndex;
                  const sceneVersionIndex = clampIndex(requestedSceneVersionIndex, sceneVersions.length);
                  const sceneVersion = sceneVersions[sceneVersionIndex] || latestSceneVersion;
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const promptDraft = sceneDrafts[sceneVersion.id] || sceneVersion.generationPrompt;
                              const hiddenReferenceImageUrl = shouldAttachHiddenReferenceImage(sceneVersion, promptDraft)
                                ? scene?.keyframeUrls?.[0]
                                : undefined;
                              onSendToGenerate({
                                prompt: promptDraft,
                                projectId: bundle.project.id,
                                sceneId: sceneVersion.originalSceneId,
                                versionId: sceneVersion.projectVersionId,
                                duration: projectMediaType === "image" ? undefined : sceneVersion.duration,
                                modelId: undefined,
                                hiddenReferenceImageUrl,
                              });
                            }}
                          >
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
                          <div className="flex h-8 items-center">
                            <label className="text-sm font-semibold">复刻 Prompt</label>
                          </div>
                          <Textarea
                            value={sceneDrafts[sceneVersion.id] ?? sceneVersion.generationPrompt}
                            onChange={(event) => updateSceneDraft(sceneVersion, event.target.value)}
                            className="mt-2 min-h-40 rounded-xl"
                          />
                        </div>
                        <div className="flex flex-col">
                          <div className="flex h-8 items-center justify-between gap-3">
                            <label className="text-sm font-semibold">AI 修改脚本</label>
                            <select
                              value={analysisOutputLanguage}
                              onChange={(event) => setAnalysisOutputLanguage(event.target.value === "en" ? "en" : "zh")}
                              className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-medium outline-none focus:border-ring"
                              aria-label="AI 修改脚本输出语言"
                            >
                              <option value="zh">中文</option>
                              <option value="en">English</option>
                            </select>
                          </div>
                          {creditStatus?.commercial?.enabled && (
                            <div className="order-last mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <select aria-label={locale === "en" ? "Rewrite payment source" : "改写费用来源"} value={rewritePayer} onChange={(event) => setRewritePayer(event.target.value === "byok" ? "byok" : "included")} disabled={Boolean(rewritingSceneId)} className="h-8 max-w-full rounded-lg border border-border bg-background px-2">
                                <option value="included">{locale === "en" ? "Included rewrites" : "套餐改写额度"} · {creditStatus.commercial.rewrites ?? 0}</option>
                                <option value="byok" disabled={!creditStatus.hasUserKieKey}>{locale === "en" ? "Own KIE key" : "自带 KIE Key"}</option>
                              </select>
                              <span>{rewritePayer === "included" ? (locale === "en" ? "1 rewrite · No extra credits" : "消耗 1 次 · 不另扣积分") : (locale === "en" ? "Billed to your KIE account" : "费用由你的 KIE 账户承担")}</span>
                            </div>
                          )}
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
                              disabled={!rewriteDrafts[sceneVersion.id]?.trim() || Boolean(rewritingSceneId) || Boolean(creditStatus?.commercial?.enabled && rewritePayer === "included" && !creditStatus.commercial.rewrites)}
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
                              aria-label={copy.copy}
                              onClick={() => void copySceneAnalysis(sceneVersion)}
                              className="flex h-8 items-center gap-1 rounded-full border border-border bg-background px-3 transition-colors hover:bg-accent"
                            >
                              {copiedSceneVersionId === sceneVersion.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              <span>{copiedSceneVersionId === sceneVersion.id ? copy.copied : copy.copy}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={copy.previousVersion}
                              disabled={sceneVersionIndex <= 0}
                              onClick={() => setSelectedSceneVersionIndexes((indexes) => ({ ...indexes, [latestSceneVersion.originalSceneId]: sceneVersionIndex - 1 }))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="min-w-14 text-center">{sceneVersionIndex + 1} / {sceneVersions.length}</span>
                            <button
                              type="button"
                              aria-label={copy.nextVersion}
                              disabled={sceneVersionIndex >= sceneVersions.length - 1}
                              onClick={() => setSelectedSceneVersionIndexes((indexes) => ({ ...indexes, [latestSceneVersion.originalSceneId]: sceneVersionIndex + 1 }))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <Textarea
                          readOnly
                          value={formatSceneAnalysis(sceneVersion, projectMediaType, copy)}
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

function formatSceneAnalysis(sceneVersion: SceneVersion, mediaType: "video" | "image", copy = workflowLabels.zh) {
  if (sceneVersion.metadata?.analysisProvider === "fallback") {
    const reason = textValue(sceneVersion.metadata?.fallbackReason) || copy.fallbackUnavailable;
    return `${copy.fallbackTitle}\n${copy.fallbackReason}：${reason}\n\n${copy.fallbackAction}`;
  }

  const sections: Array<[string, unknown]> = [
    [copy.sections.visual, pickField(sceneVersion.visual, ["sceneDescription", "subject", "environment"])],
    [copy.sections.action, `${pickField(sceneVersion.visual, ["characters", "subject"])}\n${pickField(sceneVersion.visual, ["action", "motion"])}`.trim()],
    [copy.sections.camera, `${pickField(sceneVersion.visual, ["camera"])}\n${pickField(sceneVersion.visual, ["composition"])}`.trim()],
    [copy.sections.style, `${pickField(sceneVersion.visual, ["lighting"])}\n${pickField(sceneVersion.visual, ["color"])}\n${pickField(sceneVersion.visual, ["style"])}`.trim()],
    [copy.sections.story, sceneVersion.story],
  ];

  if (mediaType === "video") {
    sections.push(
      [copy.sections.dialogue, sceneVersion.dialogue.length ? sceneVersion.dialogue : sceneVersion.subtitle],
      [copy.sections.audio, sceneVersion.audio],
      [copy.sections.edit, sceneVersion.transition],
    );
  }

  return sections
    .map(([title, value]) => `${title}\n${textValue(value) || copy.noDetectedData}`)
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
