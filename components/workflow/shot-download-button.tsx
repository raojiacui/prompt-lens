"use client";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ShotDownloadButton({ zh, sceneIndex, url, onDownload, disabled, splitCredits = 0 }: {
  zh: boolean; sceneIndex: number; url?: string; onDownload?: () => Promise<Response>; disabled?: boolean; splitCredits?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = splitCredits ? (zh ? `拆镜并下载 · ${splitCredits} 积分` : `Split and download · ${splitCredits} credits`) : (zh ? "下载镜头" : "Download shot");
  async function download() {
    setBusy(true); setError("");
    try {
      const response = onDownload ? await onDownload() : await fetch(url!, { cache: "no-store" });
      if (!response.ok) throw new Error(zh ? "镜头下载失败，请重试。" : "Shot download failed. Please retry.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const suppliedName = /filename="(shot-\d+\.(?:mp4|webm|mov))"/.exec(response.headers.get("content-disposition") || "")?.[1];
      anchor.href = objectUrl; anchor.download = suppliedName || `shot-${String(sceneIndex).padStart(2, "0")}.mp4`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : (zh ? "下载失败" : "Download failed")); }
    finally { setBusy(false); }
  }
  return <div className="min-w-0">
    <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => void download()} title={label} className="h-auto min-h-9 max-w-full whitespace-normal py-1 leading-tight">
      {busy ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <Download className="mr-2 h-4 w-4 shrink-0" />}{busy ? (zh ? "正在准备下载…" : "Preparing download…") : label}
    </Button>
    {error && <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">{error}</p>}
  </div>;
}
