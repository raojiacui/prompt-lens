"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uploadMediaToBlob } from "@/lib/vercel-blob-client";
import { useTranslations } from "next-intl";
import { Copy, Flag, Link, Paperclip, Scissors, Send, Trash2, Wand2, X, ZoomIn, ZoomOut } from "lucide-react";

interface TimelineClip {
  id: string;
  label: string;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

interface TimelineMarker {
  id: string;
  time: number;
}

type EditModelOption = { id: string; displayName: string; kieModelId: string; enabled: boolean; experimental?: boolean };
type EditResult = { outputUrl?: string; providerTaskId?: string; plan?: unknown; instruction?: unknown };

type VideoEditTabProps = {
  initialProjectId?: string | null;
  initialVersionId?: string | null;
  initialSceneId?: string | null;
};

type DragState =
  | { mode: "playhead" }
  | { mode: "clip"; clipId: string; offset: number; length: number }
  | { mode: "trim-start"; clipId: string }
  | { mode: "trim-end"; clipId: string }
  | null;

const MIN_CLIP_SECONDS = 0.3;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function VideoEditTab({ initialProjectId, initialVersionId, initialSceneId }: VideoEditTabProps) {
  const t = useTranslations("videoEdit");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [editMode, setEditMode] = useState<"auto" | "standard" | "generative">("auto");
  const [editModels, setEditModels] = useState<EditModelOption[]>([]);
  const [editModel, setEditModel] = useState("__auto__");
  const [duration, setDuration] = useState(60);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [timelineFrames, setTimelineFrames] = useState<Array<{ time: number; src: string }>>([]);
  const [clips, setClips] = useState<TimelineClip[]>([
    { id: "clip-1", label: "Clip 1", timelineStart: 0, timelineEnd: 18, sourceStart: 0, sourceEnd: 18 },
  ]);
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [activeClipId, setActiveClipId] = useState("clip-1");
  const [dragState, setDragState] = useState<DragState>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEditModels() {
      const response = await fetch("/api/models?category=video_edit");
      const data = await response.json().catch(() => ({}));
      if (!cancelled && Array.isArray(data.models)) setEditModels(data.models.filter((model: EditModelOption) => model.enabled));
    }
    void loadEditModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const examplePrompts = [t("example1"), t("example2"), t("example3")];
  const activeClip = clips.find((clip) => clip.id === activeClipId) || null;
  const previewSourceTime = getSourceTimeAtTimeline(playhead, clips);
  const timelineWidth = `${zoom * 100}%`;

  const timelineSummary = useMemo(() => {
    if (clips.length === 0) return "No manually selected clips.";
    return clips
      .slice()
      .sort((a, b) => a.timelineStart - b.timelineStart)
      .map(
        (clip, index) =>
          `${index + 1}. source ${formatTime(clip.sourceStart)}-${formatTime(clip.sourceEnd)} at timeline ${formatTime(
            clip.timelineStart
          )}-${formatTime(clip.timelineEnd)}`
      )
      .join("; ");
  }, [clips]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !Number.isFinite(playhead)) return;
    if (previewSourceTime === null) return;
    if (Math.abs(video.currentTime - previewSourceTime) > 0.08) {
      video.currentTime = clamp(previewSourceTime, 0, duration);
    }
  }, [previewSourceTime, duration]);

  const timeFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return playhead;
    return clamp(((event.clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  const updateClip = (clipId: string, updater: (clip: TimelineClip) => TimelineClip) => {
    setClips((current) => current.map((clip) => (clip.id === clipId ? updater(clip) : clip)));
  };

  const startTimelineDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextTime = timeFromPointer(event);
    setPlayhead(nextTime);
    const clipAtPlayhead = clips.find((clip) => nextTime >= clip.timelineStart && nextTime <= clip.timelineEnd);
    if (clipAtPlayhead) setActiveClipId(clipAtPlayhead.id);
    setDragState({ mode: "playhead" });
  };

  const startClipDrag = (event: React.PointerEvent<HTMLButtonElement>, clip: TimelineClip) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerTime = timeFromPointer(event as unknown as React.PointerEvent<HTMLDivElement>);
    setActiveClipId(clip.id);
    setPlayhead(pointerTime);
    setDragState({
      mode: "clip",
      clipId: clip.id,
      offset: pointerTime - clip.timelineStart,
      length: clip.timelineEnd - clip.timelineStart,
    });
  };

  const startTrimDrag = (event: React.PointerEvent<HTMLSpanElement>, clipId: string, mode: "trim-start" | "trim-end") => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveClipId(clipId);
    setDragState({ mode, clipId });
  };

  const continueTimelineDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || event.buttons !== 1) return;
    const nextTime = timeFromPointer(event);

    if (dragState.mode === "playhead") {
      setPlayhead(nextTime);
      return;
    }

    if (dragState.mode === "clip") {
      const nextStart = clamp(nextTime - dragState.offset, 0, duration - dragState.length);
      const nextEnd = nextStart + dragState.length;
      setPlayhead(nextTime);
      updateClip(dragState.clipId, (clip) => ({ ...clip, timelineStart: nextStart, timelineEnd: nextEnd }));
      return;
    }

    if (dragState.mode === "trim-start") {
      updateClip(dragState.clipId, (clip) => {
        const clipLength = clip.sourceEnd - clip.sourceStart;
        const requestedDelta = nextTime - clip.timelineStart;
        const allowedDelta = clamp(requestedDelta, -clip.sourceStart, clipLength - MIN_CLIP_SECONDS);
        const nextTimelineStart = clamp(clip.timelineStart + allowedDelta, 0, clip.timelineEnd - MIN_CLIP_SECONDS);
        const appliedDelta = nextTimelineStart - clip.timelineStart;
        return {
          ...clip,
          timelineStart: nextTimelineStart,
          sourceStart: clip.sourceStart + appliedDelta,
        };
      });
      setPlayhead(clamp(nextTime, 0, duration));
      return;
    }

    updateClip(dragState.clipId, (clip) => {
      const clipLength = clip.sourceEnd - clip.sourceStart;
      const requestedDelta = nextTime - clip.timelineEnd;
      const allowedDelta = clamp(requestedDelta, MIN_CLIP_SECONDS - clipLength, duration - clip.sourceEnd);
      const nextTimelineEnd = clamp(clip.timelineEnd + allowedDelta, clip.timelineStart + MIN_CLIP_SECONDS, duration);
      const appliedDelta = nextTimelineEnd - clip.timelineEnd;
      return {
        ...clip,
        timelineEnd: nextTimelineEnd,
        sourceEnd: clip.sourceEnd + appliedDelta,
      };
    });
    setPlayhead(clamp(nextTime, 0, duration));
  };

  const stopTimelineDrag = () => setDragState(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError(t("fileRequired"));
      return;
    }
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setTimelineFrames([]);
    setMarkers([]);
    setResult(null);
    setError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingUpload(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const resetUpload = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setVideoUrlInput("");
    setTimelineFrames([]);
    setMarkers([]);
    setResult(null);
    setClips([{ id: "clip-1", label: "Clip 1", timelineStart: 0, timelineEnd: 18, sourceStart: 0, sourceEnd: 18 }]);
    setActiveClipId("clip-1");
    setPlayhead(0);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 240)}px`;
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const nextDuration = Math.max(1, e.currentTarget.duration || 60);
    setDuration(nextDuration);
    setPlayhead(0);
    setClips([{ id: "clip-1", label: "Clip 1", timelineStart: 0, timelineEnd: nextDuration, sourceStart: 0, sourceEnd: nextDuration }]);
    setActiveClipId("clip-1");
    if (videoPreview) extractTimelineFrames(videoPreview, nextDuration);
  };

  const extractTimelineFrames = async (src: string, videoDuration: number) => {
    try {
      const video = document.createElement("video");
      video.src = src;
      video.muted = true;
      video.preload = "auto";
      await waitForEvent(video, "loadedmetadata");

      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const frameCount = 12;
      const frames: Array<{ time: number; src: string }> = [];
      for (let i = 0; i < frameCount; i++) {
        const frameTime = clamp((videoDuration * i) / frameCount, 0, Math.max(0, videoDuration - 0.1));
        video.currentTime = frameTime;
        await waitForEvent(video, "seeked");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push({ time: frameTime, src: canvas.toDataURL("image/jpeg", 0.72) });
      }
      setTimelineFrames(frames);
    } catch {
      setTimelineFrames([]);
    }
  };

  const splitAtPlayhead = () => {
    const source = clips.find((clip) => playhead > clip.timelineStart && playhead < clip.timelineEnd);
    if (!source) return;
    const sourceSplit = source.sourceStart + (playhead - source.timelineStart);
    const nextId = `clip-${Date.now()}`;
    setClips((current) =>
      current.flatMap((clip) =>
        clip.id === source.id
          ? [
              { ...clip, timelineEnd: playhead, sourceEnd: sourceSplit },
              {
                id: nextId,
                label: `Clip ${current.length + 1}`,
                timelineStart: playhead,
                timelineEnd: source.timelineEnd,
                sourceStart: sourceSplit,
                sourceEnd: source.sourceEnd,
              },
            ]
          : [clip]
      )
    );
    setActiveClipId(nextId);
  };

  const deleteClip = () => {
    if (!activeClip) return;
    const nextClips = clips.filter((clip) => clip.id !== activeClip.id);
    setClips(nextClips);
    setActiveClipId(nextClips[0]?.id || "");
  };

  const duplicateClip = () => {
    if (!activeClip) return;
    const length = activeClip.timelineEnd - activeClip.timelineStart;
    const nextStart = clamp(activeClip.timelineEnd + 0.2, 0, Math.max(0, duration - length));
    const nextId = `clip-${Date.now()}`;
    setClips((current) => [
      ...current,
      {
        ...activeClip,
        id: nextId,
        label: `Clip ${current.length + 1}`,
        timelineStart: nextStart,
        timelineEnd: nextStart + length,
      },
    ]);
    setActiveClipId(nextId);
  };

  const addMarker = () => {
    setMarkers((current) => [...current, { id: `marker-${Date.now()}`, time: playhead }]);
  };

  const handleEdit = async () => {
    setError("");
    setResult(null);

    if (!prompt.trim()) {
      setError(t("inputRequired"));
      setProgress("");
      return;
    }
    if (clips.length === 0) {
      setError("Timeline is empty. Add or keep at least one clip before editing.");
      setProgress("");
      return;
    }

    let finalVideoUrl = "";
    setIsLoading(true);

    if (!initialProjectId) {
      if (inputMode === "file") {
        if (!videoFile) {
          setError(t("fileRequired"));
          setIsLoading(false);
          return;
        }
        setProgress(t("uploading"));
        try {
          const uploadData = await uploadMediaToBlob(videoFile, (percentage) => {
            setProgress(t("uploadingProgress", { percent: Math.round(percentage) }));
          });
          finalVideoUrl = uploadData.url;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
          setIsLoading(false);
          setProgress("");
          return;
        }
      } else {
        if (!videoUrlInput.trim()) {
          setError(t("urlRequired"));
          setIsLoading(false);
          return;
        }
        finalVideoUrl = videoUrlInput.trim();
      }
    } else if (videoUrlInput.trim()) {
      finalVideoUrl = videoUrlInput.trim();
    }


    try {
      setProgress(t("processing"));

      const response = await fetch(initialProjectId ? `/api/workflow/projects/${initialProjectId}/edit` : "/api/video-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initialProjectId ? {
          prompt: `${prompt}\n\nManual timeline selection: ${timelineSummary}`,
          sourceVideoUrl: finalVideoUrl || undefined,
          versionId: initialVersionId || undefined,
          sceneId: initialSceneId || undefined,
          mode: editMode,
          modelMode: editModel === "__auto__" ? "auto" : "manual",
          modelId: editModel === "__auto__" ? undefined : editModel,
          modelPriority: "balanced",
        } : {
          mediaUrl: finalVideoUrl,
          prompt: `${prompt}\n\nManual timeline selection: ${timelineSummary}`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("editFailed"));
      }

      setResult(data);
      setProgress(t("done"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("editFailed"));
      setProgress("");
    } finally {
      setIsLoading(false);
    }
  };

  const canEdit = !isLoading && Boolean(prompt.trim()) && (Boolean(initialProjectId) || (inputMode === "file" ? Boolean(videoFile) : Boolean(videoUrlInput.trim())));

  return (
    <div className="animate-fade-in space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDraggingUpload(true); }}
        onDragLeave={() => setIsDraggingUpload(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-2xl border border-[#D8D5CC]/80 bg-[#F8F8F7]/70 shadow-[0_18px_45px_rgba(20,20,19,0.04)] backdrop-blur-sm transition-colors",
          isDraggingUpload && inputMode === "file" && "border-[#D97757]/70 bg-[#FFF8EE]/80"
        )}
      >
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(360px,1fr)]">
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[#D8D5CC]/80 bg-white/72 p-4 shadow-sm">
            <div>
              <h2 className="text-xl font-semibold text-[#141413]">Edit setup</h2>
              <p className="mt-1 text-sm text-[#6B6860]">Upload a source video, describe the edit, then refine clips on the timeline.</p>
            </div>

            <label className="grid gap-2 text-sm font-semibold text-[#141413]">
              Edit instruction
              <Textarea
                value={prompt}
                onChange={handlePromptChange}
                placeholder={t("editPlaceholder")}
                className="min-h-[118px] resize-none overflow-hidden rounded-xl border border-[#D8D5CC]/80 bg-white px-3 py-3 text-base text-[#141413] shadow-sm outline-none placeholder:text-[#AAA9A6] focus-visible:ring-2 focus-visible:ring-[#D97757]/30"
              />
            </label>

            <div className="inline-flex h-11 w-fit overflow-hidden rounded-full border border-[#D8D5CC]/70 bg-[#F5F3EC] p-1 shadow-sm">
              <button type="button" onClick={() => { setInputMode("file"); resetUpload(); }} className={cn("rounded-full px-4 text-sm font-semibold transition-colors", inputMode === "file" ? "bg-[#D97757] text-white shadow-sm" : "text-[#6B6860] hover:text-[#141413]")}>{t("uploadFile")}</button>
              <button type="button" onClick={() => { setInputMode("url"); resetUpload(); }} className={cn("rounded-full px-4 text-sm font-semibold transition-colors", inputMode === "url" ? "bg-[#D97757] text-white shadow-sm" : "text-[#6B6860] hover:text-[#141413]")}>{t("inputUrl")}</button>
            </div>

            {inputMode === "file" ? (
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#D8D5CC] bg-[#F5F3EC]/70 px-4 py-4 text-center transition-colors hover:border-[#D97757]/50 hover:bg-white">
                <Paperclip className="h-7 w-7 text-[#D97757]" />
                <span className="font-semibold text-[#141413]">{videoFile ? videoFile.name : t("uploadFile")}</span>
                <span className="text-sm text-[#6B6860]">{videoFile ? `${(videoFile.size / 1024 / 1024).toFixed(2)} MB` : "Drop a video here or click to upload"}</span>
              </button>
            ) : (
              <label className="flex items-center gap-2 rounded-xl border border-[#D8D5CC]/80 bg-white px-4 py-3 text-[#141413] shadow-sm">
                <Link className="h-4 w-4 shrink-0 text-[#9C9890]" />
                <Input type="url" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder={t("urlPlaceholder")} className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" />
              </label>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-2 text-sm font-semibold text-[#141413]">
                Edit mode
                <select value={editMode} onChange={(event) => setEditMode(event.target.value as "auto" | "standard" | "generative")} className="h-11 w-full min-w-0 rounded-xl border border-[#D8D5CC]/80 bg-white px-3 text-sm font-semibold text-[#6B6860] outline-none focus:border-[#D97757]">
                  <option value="auto">Auto edit mode</option>
                  <option value="standard">Standard Edit</option>
                  <option value="generative">Generative Edit</option>
                </select>
              </label>

              <label className="grid min-w-0 gap-2 text-sm font-semibold text-[#141413]">
                Model
                <select value={editModel} onChange={(event) => setEditModel(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-[#D8D5CC]/80 bg-white px-3 text-sm font-semibold text-[#6B6860] outline-none focus:border-[#D97757]">
                  <option value="__auto__">Auto · Balanced</option>
                  {editModels.map((model) => (
                    <option key={model.id} value={model.kieModelId}>{model.displayName}{model.experimental ? " · Experimental" : ""}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#D8D5CC]/80 bg-[#F8F8F7] px-3 py-2 text-sm font-semibold text-[#6B6860]">
              <span>{editMode === "generative" ? "KIE video edit" : "Local / worker FFmpeg"}</span>
              <span>{clips.length} clip{clips.length === 1 ? "" : "s"}</span>
            </div>

            <Button onClick={handleEdit} disabled={!canEdit} className="mt-auto h-11 w-full rounded-xl bg-[#D97757] text-white hover:bg-[#C96848] disabled:!opacity-100 disabled:bg-[#DCA28E] disabled:text-white disabled:cursor-not-allowed" aria-label={t("start")}>
              {isLoading ? <Spinner size="sm" className="mr-2" /> : <Send className="mr-2 h-5 w-5 -rotate-45" />}
              {isLoading ? t("processing") : t("start")}
            </Button>
          </section>

          <section className="flex min-w-0 flex-col rounded-2xl border border-[#D8D5CC]/80 bg-white/72 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#141413]">Preview</h2>
                <p className="text-sm text-[#6B6860]">Review source or edited output.</p>
              </div>
              {videoPreview ? (
                <button type="button" onClick={resetUpload} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F3EC] text-[#141413] shadow-sm transition-colors hover:bg-[#D97757] hover:text-white" aria-label="Remove uploaded video">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {result?.outputUrl ? (
              <div className="space-y-3">
                <video src={result.outputUrl} controls className="max-h-[360px] w-full rounded-xl bg-[#141413] object-contain" />
                <a href={result.outputUrl} download className="block">
                  <Button className="w-full rounded-xl bg-[#D97757] hover:bg-[#C96848]">{t("download")}</Button>
                </a>
              </div>
            ) : result?.providerTaskId ? (
              <div className="flex min-h-[300px] flex-col justify-center rounded-xl border border-[#D8D5CC] bg-[#F5F3EC]/70 p-6">
                <p className="text-sm font-semibold text-[#141413]">Generative edit submitted</p>
                <p className="mt-2 text-sm text-[#6B6860]">The provider task is running. The output will appear when the task finishes.</p>
                <p className="mt-4 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-[#6B6860]">{result.providerTaskId}</p>
              </div>
            ) : videoPreview ? (
              <div className="relative min-h-[300px] overflow-hidden rounded-xl border border-[#D8D5CC] bg-[#141413] shadow-sm">
                <div className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-3 py-1 font-mono text-xs text-white">
                  {formatTime(playhead)}
                </div>
                <video
                  ref={previewVideoRef}
                  src={videoPreview}
                  muted
                  playsInline
                  controls
                  onLoadedMetadata={handleLoadedMetadata}
                  className={cn("h-full max-h-[360px] w-full object-contain", previewSourceTime === null && "opacity-25")}
                />
                {previewSourceTime === null && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-semibold text-white">
                    No clip at playhead
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-[#D8D5CC] bg-[#F5F3EC]/70 p-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ECE9E0] text-[#9C9890]">
                  <Paperclip className="h-8 w-8" />
                </div>
                <p className="mb-1 font-medium text-[#141413]">Video preview will appear here</p>
                <p className="text-sm text-[#6B6860]">Upload a video or enter a URL to start editing.</p>
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-[#E4E2DD]/70 px-5 py-4">
          <div className="rounded-xl border border-[#D8D5CC]/80 bg-[#1E1E1D] p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: "Split", icon: Scissors, action: splitAtPlayhead },
                  { label: "Duplicate", icon: Copy, action: duplicateClip },
                  { label: "Marker", icon: Flag, action: addMarker },
                  { label: "Delete", icon: Trash2, action: deleteClip },
                ].map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button key={tool.label} type="button" onClick={tool.action} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#D8D5CC] transition-colors hover:bg-white/10 hover:text-white" title={tool.label}>
                      <Icon className="h-4 w-4" />
                      {tool.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setZoom((value) => clamp(value - 0.25, 1, 3))} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#D8D5CC] hover:bg-white/10 hover:text-white" aria-label="Zoom out">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-xs text-[#D8D5CC]">{formatTime(playhead)} / {formatTime(duration)}</span>
                <button type="button" onClick={() => setZoom((value) => clamp(value + 0.25, 1, 3))} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#D8D5CC] hover:bg-white/10 hover:text-white" aria-label="Zoom in">
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg bg-[#181817] p-3">
              <div
                ref={timelineRef}
                className="relative h-32 min-w-full select-none"
                style={{ width: timelineWidth }}
                onPointerDown={startTimelineDrag}
                onPointerMove={continueTimelineDrag}
                onPointerUp={stopTimelineDrag}
                onPointerCancel={stopTimelineDrag}
              >
                <div className="absolute left-0 right-0 top-0 flex justify-between text-[11px] font-medium text-[#9C9890]">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <span key={index}>{formatTime((duration / 6) * index)}</span>
                  ))}
                </div>

                {markers.map((marker) => (
                  <span key={marker.id} className="absolute top-5 z-20 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-[#F5C451]" style={{ left: `${(marker.time / duration) * 100}%` }} />
                ))}

                <div className="absolute left-0 right-0 top-9 h-20 rounded-md bg-[#2A2A29] shadow-sm">
                  {clips.length === 0 && (
                    <div className="flex h-full items-center justify-center text-sm font-medium text-[#8A857A]">
                      Timeline empty
                    </div>
                  )}

                  {clips.map((clip) => {
                    const left = (clip.timelineStart / duration) * 100;
                    const width = Math.max(4, ((clip.timelineEnd - clip.timelineStart) / duration) * 100);
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        onPointerDown={(event) => startClipDrag(event, clip)}
                        className={cn(
                          "absolute inset-y-0 cursor-grab overflow-hidden rounded-md border-2 border-l-4 bg-white text-left shadow-sm transition-colors active:cursor-grabbing",
                          activeClipId === clip.id ? "border-[#D97757]" : "border-white/80 hover:border-[#D97757]/70"
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        aria-label={clip.label}
                      >
                        <div className="flex h-full w-full opacity-95">
                          {getClipFrames(timelineFrames, clip).length > 0 ? getClipFrames(timelineFrames, clip).map((frame, index) => (
                            <img key={`${clip.id}-${index}`} src={frame.src} alt="" className="h-full min-w-0 flex-1 object-cover" draggable={false} />
                          )) : Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="h-full min-w-0 flex-1 border-r border-[#D8D5CC] bg-[#ECE9E0]" />
                          ))}
                        </div>
                        <span onPointerDown={(event) => startTrimDrag(event, clip.id, "trim-start")} className="absolute bottom-2 left-1 top-2 z-10 w-2 cursor-ew-resize rounded bg-white/85 shadow" />
                        <span onPointerDown={(event) => startTrimDrag(event, clip.id, "trim-end")} className="absolute bottom-2 right-1 top-2 z-10 w-2 cursor-ew-resize rounded bg-white/85 shadow" />
                        <span className="absolute left-4 top-2 rounded bg-[#141413]/70 px-2 py-1 font-mono text-xs text-white">{formatTime(clip.sourceEnd - clip.sourceStart)}</span>
                      </button>
                    );
                  })}
                </div>

                <span className="pointer-events-none absolute bottom-0 top-6 z-30 w-0.5 bg-white shadow-[0_0_0_1px_rgba(20,20,19,0.35)]" style={{ left: `${(playhead / duration) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
      </div>

      <div className="flex flex-wrap justify-center gap-3 px-2">
        {examplePrompts.map((example) => (
          <button key={example} type="button" onClick={() => setPrompt(example)} className="inline-flex items-center gap-2 rounded-full border border-[#D8D5CC]/70 bg-white/55 px-4 py-2 text-sm font-semibold text-[#6B6860] shadow-sm transition-colors hover:border-[#D97757]/40 hover:bg-white/80 hover:text-[#141413]">
            <Wand2 className="h-4 w-4" />
            {example}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-[#C0453A]/10 px-4 py-3 text-sm text-[#C0453A]">{error}</div>}
      {progress && <div className="flex items-center justify-center gap-2 text-sm text-[#6B6860]"><Spinner size="sm" />{progress}</div>}

    </div>
  );
}

function getClipFrames(frames: Array<{ time: number; src: string }>, clip: TimelineClip) {
  const clipFrames = frames.filter((frame) => frame.time >= clip.sourceStart && frame.time <= clip.sourceEnd);
  if (clipFrames.length > 0) return clipFrames;

  const nearestFrame = frames.find((frame) => frame.time >= clip.sourceStart) || frames[frames.length - 1];
  return nearestFrame ? [nearestFrame] : [];
}

function getSourceTimeAtTimeline(timelineTime: number, clips: TimelineClip[]) {
  const clip = clips.find((item) => timelineTime >= item.timelineStart && timelineTime <= item.timelineEnd);
  if (!clip) return null;
  return clip.sourceStart + (timelineTime - clip.timelineStart);
}
function waitForEvent(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, handleEvent);
      target.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}`));
    };
    target.addEventListener(eventName, handleEvent, { once: true });
    target.addEventListener("error", handleError, { once: true });
  });
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  return tenths > 0 ? `${mins}:${secs.toString().padStart(2, "0")}.${tenths}` : `${mins}:${secs.toString().padStart(2, "0")}`;
}