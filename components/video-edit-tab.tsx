"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type DragState =
  | { mode: "playhead" }
  | { mode: "clip"; clipId: string; offset: number; length: number }
  | { mode: "trim-start"; clipId: string }
  | { mode: "trim-end"; clipId: string }
  | null;

const MIN_CLIP_SECONDS = 0.3;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function VideoEditTab() {
  const t = useTranslations("videoEdit");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [ffmpegServiceUrl, setFfmpegServiceUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [videoUrlInput, setVideoUrlInput] = useState("");
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
    setVideoUrl("");
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

  const moveClip = (direction: -1 | 1) => {
    if (!activeClip) return;
    const index = clips.findIndex((clip) => clip.id === activeClip.id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= clips.length) return;
    const nextClips = [...clips];
    [nextClips[index], nextClips[nextIndex]] = [nextClips[nextIndex], nextClips[index]];
    setClips(nextClips);
  };

  const addMarker = () => {
    setMarkers((current) => [...current, { id: `marker-${Date.now()}`, time: playhead }]);
  };

  const handleEdit = async () => {
    setError("");
    setResult(null);

    let finalVideoUrl = "";

    if (inputMode === "file") {
      if (!videoFile) {
        setError(t("fileRequired"));
        return;
      }
      setIsLoading(true);
      setProgress(t("uploading"));
      try {
        const uploadData = await uploadMediaToBlob(videoFile, (percentage) => {
          setProgress(t("uploadingProgress", { percent: Math.round(percentage) }));
        });
        finalVideoUrl = uploadData.url;
      } catch (err: any) {
        setError(err.message);
        setIsLoading(false);
        setProgress("");
        return;
      }
    } else {
      if (!videoUrlInput.trim()) {
        setError(t("urlRequired"));
        return;
      }
      finalVideoUrl = videoUrlInput.trim();
      setIsLoading(true);
    }

    if (!ffmpegServiceUrl.trim()) {
      setError(t("ffmpegUrlRequired"));
      setIsLoading(false);
      setProgress("");
      return;
    }
    if (!prompt.trim()) {
      setError(t("inputRequired"));
      setIsLoading(false);
      setProgress("");
      return;
    }
    if (clips.length === 0) {
      setError("Timeline is empty. Add or keep at least one clip before editing.");
      setIsLoading(false);
      setProgress("");
      return;
    }

    setVideoUrl(finalVideoUrl);

    try {
      setProgress(t("processing"));

      const response = await fetch("/api/video-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: finalVideoUrl,
          prompt: `${prompt}\n\nManual timeline selection: ${timelineSummary}`,
          ffmpegServiceUrl: ffmpegServiceUrl.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("editFailed"));
      }

      setResult(data);
      setProgress(t("done"));
    } catch (err: any) {
      setError(err.message);
      setProgress("");
    } finally {
      setIsLoading(false);
    }
  };

  const canEdit = !isLoading && prompt.trim() && ffmpegServiceUrl.trim() && (inputMode === "file" ? videoFile : videoUrlInput.trim());

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
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.72fr)]">
          <div className="min-w-0 space-y-4">
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={handlePromptChange}
                placeholder={t("editPlaceholder")}
                className="min-h-[118px] resize-none overflow-hidden border-0 bg-transparent px-1 py-1 pb-12 text-xl text-[#141413] shadow-none outline-none placeholder:text-[#AAA9A6] focus-visible:ring-0"
              />
              <span className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#D97757]" />
            </div>

            {inputMode === "url" && (
              <label className="flex items-center gap-2 rounded-xl border border-[#D8D5CC]/80 bg-white/72 px-4 py-3 text-[#141413] shadow-sm">
                <Link className="h-4 w-4 shrink-0 text-[#9C9890]" />
                <Input type="url" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder={t("urlPlaceholder")} className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" />
              </label>
            )}
          </div>

          {videoPreview ? (
            <div className="relative min-h-[220px] overflow-hidden rounded-xl border border-[#D8D5CC] bg-[#141413] shadow-sm">
              <div className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-3 py-1 font-mono text-xs text-white">
                {formatTime(playhead)}
              </div>
              <video
                ref={previewVideoRef}
                src={videoPreview}
                muted
                playsInline
                onLoadedMetadata={handleLoadedMetadata}
                className={cn("h-full max-h-[280px] w-full object-contain", previewSourceTime === null && "opacity-25")}
              />
                            {previewSourceTime === null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-semibold text-white">
                  No clip at playhead
                </div>
              )}
              <button type="button" onClick={resetUpload} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#141413] shadow-sm transition-colors hover:bg-[#D97757] hover:text-white" aria-label="Remove uploaded video">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#D8D5CC] bg-[#F5F3EC]/70 p-6 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ECE9E0] text-[#9C9890]">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="mb-1 font-medium text-[#141413]">Video preview will appear here</p>
              <p className="text-sm text-[#6B6860]">Upload a video or enter a URL to start editing.</p>
            </div>
          )}
        </div>

        <div className="border-t border-[#E4E2DD]/70 px-5 py-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex h-11 overflow-hidden rounded-full border border-[#D8D5CC]/70 bg-white/72 p-1 shadow-sm backdrop-blur-sm">
                <button type="button" onClick={() => { setInputMode("file"); resetUpload(); }} className={cn("rounded-full px-4 text-sm font-semibold transition-colors", inputMode === "file" ? "bg-[#D97757] text-white shadow-sm" : "text-[#6B6860] hover:text-[#141413]")}>{t("uploadFile")}</button>
                <button type="button" onClick={() => { setInputMode("url"); resetUpload(); }} className={cn("rounded-full px-4 text-sm font-semibold transition-colors", inputMode === "url" ? "bg-[#D97757] text-white shadow-sm" : "text-[#6B6860] hover:text-[#141413]")}>{t("inputUrl")}</button>
              </div>

              {inputMode === "file" && (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#9C9890] transition-colors hover:bg-[#F5F3EC] hover:text-[#D97757]" aria-label={t("uploadFile")}>
                  <Paperclip className="h-7 w-7" />
                </button>
              )}

              <label className="inline-flex h-11 min-w-[260px] items-center gap-2 rounded-full border border-[#D8D5CC]/70 bg-white/72 px-4 text-base font-medium text-[#141413] shadow-sm backdrop-blur-sm">
                FFmpeg:
                <Input value={ffmpegServiceUrl} onChange={(e) => setFfmpegServiceUrl(e.target.value)} placeholder={t("ffmpegUrlPlaceholder")} className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0" />
              </label>
            </div>

            <Button onClick={handleEdit} disabled={!canEdit} className="h-12 w-12 rounded-xl bg-white/45 p-0 text-[#B8B8B8] hover:bg-[#D97757] hover:text-white disabled:hover:bg-white/45 disabled:hover:text-[#B8B8B8]" aria-label={t("start")}>
              {isLoading ? <Spinner size="sm" /> : <Send className="h-6 w-6 -rotate-45" />}
            </Button>
          </div>

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

      {result && result.outputUrl && (
        <Card className="border-[#D8D5CC] bg-white/75 shadow-sm backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-[#141413]" style={{ fontFamily: "var(--font-display)" }}>{t("result")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <video src={result.outputUrl} controls className="w-full rounded-xl" />
            <a href={result.outputUrl} download className="block">
              <Button className="w-full rounded-xl bg-[#D97757] hover:bg-[#C96848]">{t("download")}</Button>
            </a>
            {result.instruction && (
              <pre className="max-h-[320px] overflow-auto rounded-xl bg-[#F8F8F7]/80 p-5 text-xs leading-relaxed text-[#141413]">
                {JSON.stringify(result.instruction, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
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