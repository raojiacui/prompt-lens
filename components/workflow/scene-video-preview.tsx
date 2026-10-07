"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export function SceneVideoPreview({ mediaUrl, startUs, endUs, label, zh, onPlay }: {
  mediaUrl: string;
  startUs: number;
  endUs: number;
  label: string;
  zh: boolean;
  onPlay: (video: HTMLVideoElement) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const start = startUs / 1000000;
  const end = endUs / 1000000;
  const duration = end - start;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (!entry.isIntersecting) {
        video.current?.pause();
        setReady(false);
        setPlaying(false);
        setPosition(0);
      }
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  // Preview the detected interval from the stored source without creating another paid task.
  // Frame-by-frame bounds also prevent seeking/playback from leaking into the next shot.
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => {
      const element = video.current;
      if (!element) return;
      if (element.currentTime >= end - 0.02) {
        element.pause();
        element.currentTime = Math.max(start, end - 0.04);
        setPosition(duration);
        return;
      }
      setPosition(Math.max(0, element.currentTime - start));
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, start, end, duration]);

  async function togglePlayback() {
    const element = video.current;
    if (!element || !ready) return;
    if (!element.paused) { element.pause(); return; }
    if (position >= duration || element.currentTime >= end - 0.05) {
      element.currentTime = start;
      setPosition(0);
    }
    try { await element.play(); }
    catch { setPlaying(false); }
  }

  const playLabel = playing ? (zh ? "暂停" : "Pause") : position >= duration ? (zh ? "重播" : "Replay") : (zh ? "播放" : "Play");
  return <div ref={container} role="group" aria-label={label} className="relative aspect-video w-full overflow-hidden rounded-lg bg-black text-white">
    {visible && <video
      key={attempt}
      ref={video}
      src={`${mediaUrl.split("#")[0]}#t=${start},${end}`}
      preload="metadata"
      playsInline
      muted={muted}
      aria-label={label}
      className="h-full w-full object-contain"
      onLoadedMetadata={(event) => {
        event.currentTarget.currentTime = start + Math.min(0.04, duration / 2);
      }}
      onLoadedData={() => setReady(true)}
      onSeeked={(event) => { if (event.currentTarget.readyState >= 2) setReady(true); }}
      onSeeking={(event) => {
        const element = event.currentTarget;
        if (element.currentTime < start || element.currentTime >= end) {
          element.currentTime = Math.min(Math.max(element.currentTime, start), end - Math.min(0.04, duration / 2));
        }
      }}
      onPlay={(event) => { setPlaying(true); onPlay(event.currentTarget); }}
      onPause={(event) => {
        setPlaying(false);
        if (event.currentTarget.currentTime >= end - 0.05) setPosition(duration);
      }}
      onEnded={() => { setPlaying(false); setPosition(duration); }}
      onError={() => { setFailed(true); setReady(false); setPlaying(false); }}
    />}
    {!ready && !failed && <div role="status" aria-label={zh ? "加载镜头画面" : "Loading shot preview"} className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin" size={24} /></div>}
    {failed && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black px-3 text-center text-sm">
      <span>{zh ? "镜头预览加载失败" : "Shot preview could not load"}</span>
      <button type="button" className="flex min-h-9 items-center gap-2 px-3 underline" onClick={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}><RotateCcw size={16} />{zh ? "重试" : "Retry"}</button>
    </div>}
    {!failed && <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-1 bg-black/75 px-2 pb-2 pt-1">
      <button type="button" disabled={!ready} onClick={() => void togglePlayback()} aria-label={playLabel} title={playLabel} className="flex h-9 w-9 shrink-0 items-center justify-center disabled:opacity-50">{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <span className="min-w-0 flex-1 text-xs tabular-nums">{timeLabel(position)} / {timeLabel(duration)}</span>
      <input type="range" aria-label={zh ? "镜头播放进度" : "Shot playback position"} min={0} max={duration} step={0.01} value={position} disabled={!ready} className="order-last h-3 w-full min-w-0 accent-white" onChange={(event) => {
        const value = Number(event.target.value);
        if (video.current) video.current.currentTime = start + Math.min(value, duration - Math.min(0.04, duration / 2));
        setPosition(value);
      }} />
      <button type="button" onClick={() => setMuted(value => !value)} aria-label={muted ? (zh ? "开启声音" : "Unmute") : (zh ? "静音" : "Mute")} title={muted ? (zh ? "开启声音" : "Unmute") : (zh ? "静音" : "Mute")} className="flex h-9 w-9 shrink-0 items-center justify-center">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
      <button type="button" aria-label={zh ? "全屏" : "Fullscreen"} title={zh ? "全屏" : "Fullscreen"} className="flex h-9 w-9 shrink-0 items-center justify-center" onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void container.current?.requestFullscreen?.().catch(() => undefined);
      }}><Maximize size={18} /></button>
    </div>}
  </div>;
}
