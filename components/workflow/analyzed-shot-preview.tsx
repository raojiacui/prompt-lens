"use client";

import { useState } from "react";
import { SceneVideoPreview } from "./scene-video-preview";

type Shot = { id: string; sceneIndex: number; referenceVideoId?: string | null; startTime: number; endTime: number; clipUrl?: string | null; keyframeUrls: string[] };
type Reference = { id?: string; sourceUrl: string };
type Props = { scene?: Shot; references?: Reference[]; zh: boolean };

export function AnalyzedShotPreview(props: Props) {
  return <ShotPreview key={`${props.scene?.id}:${props.scene?.clipUrl}`} {...props} />;
}

function ShotPreview({ scene, references = [], zh }: Props) {
  const [clipFailed, setClipFailed] = useState(false);
  const source = scene?.referenceVideoId
    ? references.find(reference => reference.id === scene.referenceVideoId)
    : references.length === 1 ? references[0] : undefined;
  const label = zh ? `镜头 ${String(scene?.sceneIndex || 0).padStart(2, "0")} 预览` : `Shot ${scene?.sceneIndex || 0} preview`;
  if (scene?.clipUrl && !clipFailed) return <video src={scene.clipUrl} aria-label={label} controls preload="metadata" onError={() => setClipFailed(true)} className="mt-3 max-h-64 w-full rounded-xl bg-black object-contain" />;
  if (scene && source?.sourceUrl && Number.isFinite(scene.startTime) && Number.isFinite(scene.endTime) && scene.endTime > scene.startTime && scene.startTime >= 0) return <div className="mt-3">
    <SceneVideoPreview mediaUrl={source.sourceUrl} startUs={Math.round(scene.startTime * 1e6)} endUs={Math.round(scene.endTime * 1e6)} label={label} zh={zh} onPlay={video => {
      document.querySelectorAll("video").forEach(other => { if (other !== video) other.pause(); });
    }} />
    <p className="mt-1 text-xs text-muted-foreground">{zh ? "原视频分段预览" : "Preview from the original video"}</p>
  </div>;
  if (scene?.keyframeUrls?.[0]) return <img src={scene.keyframeUrls[0]} alt={label} className="mt-3 max-h-64 w-full rounded-xl object-contain" />;
  return <p role="status" className="mt-3 text-sm text-muted-foreground">{zh ? "镜头预览素材暂不可用，提示词已保留。" : "Shot preview is unavailable. Your prompt is preserved."}</p>;
}
