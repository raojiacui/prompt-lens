"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { fetchWithSessionRefresh } from "@/lib/auth/session-fetch";
import { listModels } from "@/lib/ai/model-registry";

export type ImageAnalysisSource = { projectId: string; mediaUrl: string; mediaName: string; modelId: string; outputLanguage: "zh" | "en" };
export function ImageAnalysisQuotePanel({ source, onConfirmed, onClose }: { source: ImageAnalysisSource; onConfirmed: (id: string) => void; onClose: () => void }) {
  const zh = useLocale() !== "en";
  const [quote, setQuote] = useState<{ id: string; credits: number; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  async function requestQuote() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetchWithSessionRefresh("/api/commercial/image-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code || "IMAGE_QUOTE_UNAVAILABLE");
      setQuote(data);
    } catch (e) { setError(e instanceof Error ? e.message : "IMAGE_QUOTE_UNAVAILABLE"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  useEffect(() => { void requestQuote(); }, []);
  async function confirm() {
    if (!quote || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setUncertain(true);
    try {
      const response = await fetchWithSessionRefresh(`/api/commercial/tasks/${quote.id}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        if (["INSUFFICIENT_COMMERCIAL_BALANCE", "QUOTE_EXPIRED", "TASK_NOT_FOUND", "COMMERCIAL_NOT_ENABLED"].includes(data.code)) setUncertain(false);
        throw new Error(data.code || "TASK_CONFIRMATION_UNKNOWN");
      }
      onConfirmed(quote.id);
    } catch (e) { setError(e instanceof Error ? e.message : "TASK_CONFIRMATION_UNKNOWN"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="rounded-xl border border-border p-5 space-y-3" aria-label={zh ? "图片分析报价" : "Image analysis quote"}>
    <p className="font-semibold">{zh ? "图片分析 · 1 张" : "Image analysis · 1 image"}{quote ? ` · ${quote.credits} ${zh ? "积分" : "credits"}` : ""}</p>
    <p className="text-sm">{listModels("analysis").find(model => model.id === source.modelId)?.displayName || source.modelId} · {zh ? "平台 KIE" : "Platform KIE"}</p>
    <p className="text-sm text-muted-foreground">{zh ? "确认后预留积分，有效分析结果保存成功才扣费；失败释放。图片不使用视频免费试用次数。" : "Credits are reserved on confirmation and charged only after a valid result is saved. Failure releases the reservation. Video trials do not cover images."}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error === "INSUFFICIENT_COMMERCIAL_BALANCE" ? (zh ? "积分不足，请先充值后再确认。" : "Insufficient credits. Top up before confirming.") : error}</p>}
    {uncertain && error && <p className="text-sm">{zh ? "确认状态暂未核实，请重试确认同一任务，避免重复提交。" : "Confirmation is uncertain. Retry this same task."}</p>}
    <button className="rounded-lg bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => void (quote ? confirm() : requestQuote())}>{busy ? (zh ? "处理中…" : "Working…") : quote ? (zh ? "确认并分析" : "Confirm analysis") : (zh ? "重试获取报价" : "Retry quote")}</button>
    <button className="ml-3" disabled={busy || uncertain} onClick={onClose}>{zh ? "取消" : "Cancel"}</button>
  </section>;
}
