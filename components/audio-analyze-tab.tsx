"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uploadMediaToR2 } from "@/lib/r2-upload-client";
import { useTranslations } from "next-intl";
import { Copy, Download, Mic2, Upload, X } from "lucide-react";

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

interface SubtitleCue {
  index: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface VideoSegment {
  start: number;
  end: number;
  summary: string;
  tags: string[];
  originalText?: string;
  translation?: string;
  pronunciation?: string;
  practiceTip?: string;
}

interface AudioAnalyzeResult {
  id: string;
  language: string;
  transcription: TranscriptionSegment[];
  segments: VideoSegment[];
  subtitles: SubtitleCue[];
  srt: string;
  vtt: string;
  duration: number;
}

type Tab = "analyze" | "history" | "settings" | "audio" | "edit" | "video-gen" | "stats";

interface AudioAnalyzeTabProps {
  activeTab: Tab;
  initialProjectId?: string | null;
  initialVersionId?: string | null;
}

type AudioModelOption = { id: string; displayName: string; kieModelId: string; enabled: boolean; experimental?: boolean; capabilities?: string[] };
type WorkflowAudioResult = {
  plan: {
    modelId: string;
    cues: Array<{ id: string; text: string; speaker: string; start: number; end: number }>;
    subtitles: Array<{ text: string; start: number; end: number }>;
    bgm: { prompt: string; level: number };
    sfx: Array<{ prompt: string; at: number }>;
    srt: string;
  };
  subtitleAsset?: { url: string };
};

export function AudioAnalyzeTab({ activeTab, initialProjectId, initialVersionId }: AudioAnalyzeTabProps) {
  const t = useTranslations("audioAnalyze");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<AudioAnalyzeResult | null>(null);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [whisperModel] = useState("kie");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [audioModels, setAudioModels] = useState<AudioModelOption[]>([]);
  const [transcriptionModel, setTranscriptionModel] = useState("elevenlabs-speech-to-text");
  const [workflowModel, setWorkflowModel] = useState("__auto__");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowResult, setWorkflowResult] = useState<WorkflowAudioResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAudioModels() {
      const response = await fetch("/api/models?category=audio");
      const data = await response.json().catch(() => ({}));
      if (!cancelled && Array.isArray(data.models)) setAudioModels(data.models.filter((model: AudioModelOption) => model.enabled));
    }
    void loadAudioModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleWorkflowAudio = async () => {
    if (!initialProjectId) return;
    setWorkflowLoading(true);
    setWorkflowError("");
    setWorkflowResult(null);
    try {
      const response = await fetch(`/api/workflow/projects/${initialProjectId}/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: initialVersionId || undefined,
          modelMode: workflowModel === "__auto__" ? "auto" : "manual",
          modelId: workflowModel === "__auto__" ? undefined : workflowModel,
          modelPriority: "balanced",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Audio production failed");
      setWorkflowResult(data);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : "Audio production failed");
    } finally {
      setWorkflowLoading(false);
    }
  };
  const handleFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      alert(t("videoFileRequired"));
      return;
    }
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setClipUrl(null);
    setSelectedSegments([]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCustomPrompt(e.target.value);
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 220)}px`;
  };

  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error || "Unknown error");

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsLoading(true);
    setProgress(t("uploading"));
    setResult(null);
    setClipUrl(null);

    try {
      const uploadData = await uploadMediaToR2(selectedFile, (percentage) => {
        setProgress(t("uploadingProgress", { percent: Math.round(percentage) }));
      });

      const url = uploadData.url;
      if (!url) {
        throw new Error(t("uploadEmptyUrl", { response: JSON.stringify(uploadData) }));
      }
      setVideoUrl(url);
      setProgress(t("extracting"));

      let analyzeRes;
      try {
        analyzeRes = await fetch("/api/audio-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaUrl: url,
            whisperModelSize: whisperModel,
            modelMode: "manual",
            modelId: transcriptionModel,
            modelPriority: "balanced",
            prompt: customPrompt || undefined,
          }),
        });
      } catch (fetchError: unknown) {
        throw new Error(t("networkError", { message: getErrorMessage(fetchError) }));
      }

      if (!analyzeRes.ok) {
        let errMsg = `Server error: ${analyzeRes.status}`;
        try {
          const err = await analyzeRes.json();
          errMsg = err.error || errMsg;
        } catch {
          // Ignore non-JSON error bodies.
        }
        throw new Error(errMsg);
      }

      const data = await analyzeRes.json() as Partial<AudioAnalyzeResult>;
      const nextSegments = Array.isArray(data.segments) ? data.segments : [];
      const nextResult: AudioAnalyzeResult = {
        id: data.id || "",
        language: data.language || "unknown",
        transcription: Array.isArray(data.transcription) ? data.transcription : [],
        segments: nextSegments,
        subtitles: Array.isArray(data.subtitles) ? data.subtitles : [],
        srt: typeof data.srt === "string" ? data.srt : "",
        vtt: typeof data.vtt === "string" ? data.vtt : "",
        duration: typeof data.duration === "number" ? data.duration : 0,
      };
      setResult(nextResult);
      setSelectedSegments(nextSegments.map((_, i) => i));
    } catch (error: unknown) {
      alert(`Error: ${getErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
      setProgress("");
    }
  };
  const handleClip = async () => {
    if (!result || selectedSegments.length === 0) return;
    setClipLoading(true);

    try {
      const segments = selectedSegments.map((i) => result.segments[i]);

      const clipRes = await fetch("/api/audio-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: videoUrl,
          segments,
          outputFormat: "merge",
        }),
      });

      if (!clipRes.ok) {
        const err = await clipRes.json();
        throw new Error(err.error || "Clip failed");
      }

      const data = await clipRes.json();
      setClipUrl(data.clipUrl);
    } catch (error: unknown) {
      alert(`Error: ${getErrorMessage(error)}`);
    } finally {
      setClipLoading(false);
    }
  };

  const toggleSegment = (index: number) => {
    setSelectedSegments((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getLanguageDisplay = (language: string) => {
    if (language === "ko") return t("languageKoreanShort");
    if (language === "unknown") return t("languageUnknown");
    return language;
  };

  const getSubtitleFileName = (extension: "srt" | "vtt") => {
    const baseName = selectedFile?.name.replace(/\.[^.]+$/, "") || "video-subtitles";
    return `${baseName}.${extension}`;
  };

  const downloadTextFile = (content: string, fileName: string, mimeType: string) => {
    if (!content) return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const copyText = async (content: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      alert(t("copyFailed"));
    }
  };

  const resetUpload = () => {
    setSelectedFile(null);
    setPreview(null);
    setVideoUrl("");
    setResult(null);
    setClipUrl(null);
    setSelectedSegments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (activeTab !== "audio") return null;

  const transcriptionModels = audioModels.filter((model) => model.capabilities?.includes("transcription"));
  const canAnalyze = !isLoading && Boolean(selectedFile);

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-background text-foreground">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {initialProjectId ? "Audio Production" : (t("title") || "Audio Analysis")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {initialProjectId ? "Generate dialogue, narration, subtitles, BGM notes, and SFX cues from the current video blueprint." : (t("subtitle") || "Transcribe audio and extract clip-worthy segments.")}
            </p>
          </div>
        </div>

        {initialProjectId ? (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Workflow audio package</h2>
                <p className="mt-1 text-sm text-muted-foreground">Uses the active project version and writes subtitles/audio cues back to the workflow.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="grid gap-2 text-sm font-medium">
                  Model
                  <select value={workflowModel} onChange={(event) => setWorkflowModel(event.target.value)} className="h-10 min-w-56 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring">
                    <option value="__auto__">Auto · Balanced</option>
                    {audioModels.map((model) => (
                      <option key={model.id} value={model.kieModelId}>{model.displayName}{model.experimental ? " · Experimental" : ""}</option>
                    ))}
                  </select>
                </label>
                <Button onClick={() => void handleWorkflowAudio()} disabled={workflowLoading} className="h-10 rounded-xl bg-[#D97757] text-white hover:bg-[#C96848] disabled:!opacity-100 disabled:bg-[#DCA28E] disabled:text-white">
                  {workflowLoading ? <Spinner size="sm" className="mr-2" /> : <Mic2 className="mr-2 h-4 w-4" />}
                  Build Audio
                </Button>
              </div>
            </div>
            {workflowError ? <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{workflowError}</p> : null}
            {workflowResult ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-sm font-semibold">Voice cues</p>
                  <p className="mt-1 text-2xl font-semibold">{workflowResult.plan.cues.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Model: {workflowResult.plan.modelId}</p>
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-sm font-semibold">Subtitles</p>
                  <p className="mt-1 text-2xl font-semibold">{workflowResult.plan.subtitles.length}</p>
                  {workflowResult.subtitleAsset?.url ? <a href={workflowResult.subtitleAsset.url} target="_blank" className="mt-1 block text-xs text-primary hover:underline">Open SRT</a> : null}
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-sm font-semibold">BGM / SFX</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{workflowResult.plan.bgm.prompt}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{workflowResult.plan.sfx.length} SFX cue{workflowResult.plan.sfx.length === 1 ? "" : "s"}</p>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="grid items-stretch gap-4 xl:grid-cols-[0.74fr_1.26fr]">
          <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex h-full flex-col space-y-4">
              <div>
                <h2 className="text-xl font-semibold">
                  {t("panelTitle") || "Upload & Analyze"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("panelDescription") || "Upload a video to extract dialogue and subtitles."}
                </p>
              </div>

              <div
                className={cn(
                  "rounded-2xl border border-dashed border-border bg-muted/30 p-3 transition-colors",
                  isDragging && "border-primary/70 bg-primary/5"
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                />

                {selectedFile && preview ? (
                  <div className="mb-3 flex flex-wrap gap-3">
                    <div className="relative flex h-24 w-32 items-center justify-center overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                      {selectedFile.type.startsWith("video/") ? (
                        <video src={preview} className="h-full w-full object-cover" muted />
                      ) : (
                        <Mic2 className="h-9 w-9 text-primary" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
                        aria-label="Remove uploaded media"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex min-w-0 flex-col justify-center">
                      <p className="max-w-[320px] truncate text-sm font-medium text-foreground">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-background py-3 text-center transition-colors hover:bg-accent"
                >
                  <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <span className="text-base font-semibold">{t("uploadFile")}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("dropHere")}
                  </span>
                </button>
              </div>

              <div className="rounded-2xl border border-border bg-background p-3">
                <Textarea
                  value={customPrompt}
                  onChange={handlePromptChange}
                  placeholder={t("customPromptPlaceholder")}
                  className="min-h-[108px] resize-none overflow-hidden border-0 bg-transparent p-0 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  分析模型
                  <select
                    value={transcriptionModel}
                    onChange={(event) => setTranscriptionModel(event.target.value)}
                    className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                  >
                    {transcriptionModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}{model.experimental ? " · Experimental" : ""}
                      </option>
                    ))}
                  </select>
                </label>

              </div>

              {progress || isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner size="sm" />
                  <span>{progress || t("processing")}</span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={!canAnalyze}
                className="mt-auto flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[#D97757] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#C96848] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading ? <Spinner size="sm" /> : <Mic2 className="h-5 w-5" />}
                {isLoading ? t("processing") : t("start")}
              </button>
            </div>
          </section>

          <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm">
            {!result ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Mic2 className="h-8 w-8" />
                </div>
                <p className="font-medium text-foreground">
                  {t("emptyHint") || "Audio analysis result will appear here"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("emptyDescription") || "Upload a video on the left and click start recognition."}
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col gap-4 overflow-hidden">
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-row items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold text-foreground">{t("result")}</h3>
                    <div className="flex flex-wrap justify-end gap-2 text-xs font-medium text-muted-foreground">
                      <span className="rounded-full bg-muted px-3 py-1">{t("language")}: {getLanguageDisplay(result.language)}</span>
                      <span className="rounded-full bg-muted px-3 py-1">{t("duration")}: {formatTime(result.duration)}</span>
                      <span className="rounded-full bg-muted px-3 py-1">{t("segments")}: {result.segments.length}</span>
                      <span className="rounded-full bg-muted px-3 py-1">{t("subtitles")}: {result.subtitles.length}</span>
                    </div>
                  </div>
                  <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                    {result.segments.map((seg, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleSegment(i)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                          selectedSegments.includes(i) ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/35"
                        )}
                      >
                        <Checkbox
                          checked={selectedSegments.includes(i)}
                          onChange={() => toggleSegment(i)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-primary">{formatTime(seg.start)} - {formatTime(seg.end)}</span>
                            {seg.tags.slice(0, 3).map((tag, j) => (<span key={j} className="text-xs text-muted-foreground">#{tag}</span>))}
                          </span>
                          {(seg.originalText || seg.translation || seg.pronunciation) ? (
                            <span className="mt-2 block space-y-2 text-sm leading-relaxed text-foreground">
                              {seg.originalText && (
                                <span className="block break-words text-base font-medium text-foreground">{seg.originalText}</span>
                              )}
                              {seg.translation && (
                                <span className="block break-words text-muted-foreground"><span className="font-medium text-foreground">{t("koreanTranslation")}</span> {seg.translation}</span>
                              )}
                              {seg.pronunciation && (
                                <span className="block break-words rounded-lg bg-muted/50 px-3 py-2 text-primary"><span className="font-medium text-foreground">{t("koreanPronunciation")}</span> {seg.pronunciation}</span>
                              )}
                              {seg.practiceTip && (
                                <span className="block break-words text-xs text-muted-foreground"><span className="font-medium text-muted-foreground">{t("koreanPracticeTip")}</span> {seg.practiceTip}</span>
                              )}
                              {seg.summary && <span className="block break-words text-xs text-muted-foreground">{seg.summary}</span>}
                            </span>
                          ) : (
                            <span className="block text-sm leading-relaxed text-foreground">{seg.summary}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>

                  <Button
                    onClick={handleClip}
                    disabled={selectedSegments.length === 0 || clipLoading}
                    className="mt-4 w-full rounded-xl bg-[#D97757] text-white shadow-sm transition-all hover:bg-[#C96848] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {clipLoading ? (
                      <span className="flex items-center gap-2"><Spinner size="sm" className="border-white" />{t("clipping")}</span>
                    ) : (
                      t("clipSelected", { count: selectedSegments.length })
                    )}
                  </Button>
                </div>

                <div className="rounded-xl border border-border bg-background p-4">
                  <h3 className="text-lg font-semibold text-foreground">{t("transcript")}</h3>
                  <div className="mt-3 max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-4 text-sm leading-relaxed text-foreground">
                    {result.transcription.map((seg, i) => (
                      <span key={i}><span className="mr-2 font-mono text-xs text-primary">[{formatTime(seg.start)}]</span>{seg.speaker ? `${seg.speaker}: ` : ""}{seg.text}{" "}</span>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{t("subtitleFile")}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t("subtitleCount", { count: result.subtitles.length })}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={!result.srt} onClick={() => void copyText(result.srt)}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        {t("copySrt")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={!result.srt} onClick={() => downloadTextFile(result.srt, getSubtitleFileName("srt"), "application/x-subrip;charset=utf-8")}>
                        <Download className="mr-2 h-3.5 w-3.5" />
                        {t("downloadSrt")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={!result.vtt} onClick={() => downloadTextFile(result.vtt, getSubtitleFileName("vtt"), "text/vtt;charset=utf-8")}>
                        <Download className="mr-2 h-3.5 w-3.5" />
                        {t("downloadVtt")}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground">
                    {result.srt || t("noSubtitles")}
                  </div>
                </div>

                {clipUrl && (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <h3 className="text-lg font-semibold text-foreground">{t("clipDone")}</h3>
                    <div className="mt-3 space-y-3">
                      <video src={clipUrl} className="w-full rounded-xl" controls />
                      <a href={clipUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-medium text-primary hover:underline">{t("downloadVideo")}</a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
