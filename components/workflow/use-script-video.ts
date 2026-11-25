"use client";
import { useEffect, useRef, useState } from "react";
import { fetchWithSessionRefresh } from "@/lib/auth/session-fetch";
import { advanceGenerationProgress, isGenerationStage } from "@/lib/reference-video/generation-progress";
import type { GenerationVariant } from "@/lib/reference-video/types";
import type { ScriptVideoSnapshot } from "@/lib/workflow/script-video-preview";
import type { ScriptVideoSettings } from "@/lib/workflow/script-video-compiler";

export type ScriptVideoPreview = { snapshot: ScriptVideoSnapshot; token: string; canGenerate: boolean; payload: unknown };
export function useScriptVideo(projectId: string, versionId: string, revision: number, language: "zh" | "en", expiresAt?: string) {
  const url = `/api/workflow/projects/${projectId}/script/video`;
  const storageKey = `promptlens:script-video:${projectId}:${versionId}`;
  const [preview, setPreview] = useState<ScriptVideoPreview | null>(null);
  const [variant, setVariant] = useState<GenerationVariant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [taskId, setTaskId] = useState("");
  const lock = useRef(false), polling = useRef(false), active = useRef(true);
  const variantRef = useRef(variant); variantRef.current = variant;
  const tr = (cn: string, en: string) => language === "zh" ? cn : en;
  function remember(id: string) {
    try { if (id) localStorage.setItem(storageKey, JSON.stringify({ id, expiresAt: expiresAt || new Date(Date.now() + 7 * 86400000).toISOString() })); else localStorage.removeItem(storageKey); }
    catch { setStorageError(true); }
  }
  async function json(response: Response) {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = new Error(data?.error || tr("请求暂未完成，请稍后查询。", "Request unavailable; retrieve its status later.")) as Error & { code?: string };
      failure.code = data?.code;
      throw failure;
    }
    return data;
  }
  const initial = (id: string): GenerationVariant => ({ id, label: "Primary output", status: "generating", progress: 0, notes: "", lifecycle: advanceGenerationProgress(undefined, "preparing") });
  async function refresh(id = taskId) {
    if (!id || polling.current) return;
    polling.current = true;
    try {
      const job = await json(await fetchWithSessionRefresh(`${url}?generationId=${encodeURIComponent(id)}`, { cache: "no-store" }));
      let next = { ...(variantRef.current || initial(id)), providerTaskId: job.providerTaskId || undefined, error: job.error || undefined };
      if (job.providerTaskId) {
        const status = await json(await fetchWithSessionRefresh(`/api/generation-jobs?taskId=${encodeURIComponent(job.providerTaskId)}`, { cache: "no-store" }));
        const stage = status.status === "success" ? "complete" : status.stage === "reviewing_output" ? "reviewing_output" : "generating";
        next = { ...next, status: status.status === "success" ? "completed" : status.status === "fail" ? "failed" : status.status === "review" ? "review" : "generating",
          videoUrl: status.status === "success" ? status.videoUrl : undefined, error: status.error,
          lifecycle: advanceGenerationProgress(next.lifecycle, stage) };
      } else {
        const stage = isGenerationStage(job.stage) ? job.stage : job.stage === "unknown_submission" ? "submitting" : "preparing";
        next = { ...next, status: job.status === "failed" ? "failed" : job.stage === "unknown_submission" ? "review" : "generating", lifecycle: advanceGenerationProgress(next.lifecycle, stage) };
      }
      if (active.current) { setVariant(next); setError(""); }
    } catch (reason) {
      if (active.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setVariant(previous => previous ? { ...previous, lifecycle: previous.lifecycle ? { ...previous.lifecycle, connection: "error" } : undefined } : previous);
      }
    } finally { polling.current = false; }
  }
  useEffect(() => {
    active.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved?.id && new Date(saved.expiresAt).getTime() > Date.now()) { setTaskId(saved.id); setVariant(initial(saved.id)); }
      else localStorage.removeItem(storageKey);
    } catch { setStorageError(true); }
    return () => { active.current = false; };
  }, [storageKey]);
  useEffect(() => {
    if (!taskId || busy || ["completed", "failed", "review"].includes(variant?.status || "")) return;
    void refresh(taskId);
    const timer = setInterval(() => void refresh(taskId), 5000);
    return () => clearInterval(timer);
  }, [taskId, variant?.status, busy]);
  async function prepare(settings: ScriptVideoSettings, editedPrompt?: string) {
    if (lock.current || taskId) return null;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await json(await fetchWithSessionRefresh(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", versionId, revision, language, settings, ...(editedPrompt !== undefined ? { editedPrompt } : {}) }) })) as ScriptVideoPreview;
      setPreview(result); return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
    finally { setBusy(false); lock.current = false; }
  }
  async function submit() {
    if (lock.current || !preview || taskId) return;
    lock.current = true; setBusy(true); setError("");
    const id = preview.snapshot.generationId;
    // Persist the identifier before making a paid request. A reload only retrieves it.
    remember(id); setTaskId(id); setVariant(initial(id));
    try {
      const job = await json(await fetchWithSessionRefresh(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", token: preview.token, confirmedCost: true }) }));
      if (job.status === "failed") setVariant({ ...initial(id), status: "failed", error: job.error });
      else if (job.stage === "unknown_submission") setVariant({ ...initial(id), status: "review", error: job.error, lifecycle: advanceGenerationProgress(undefined, "submitting") });
      await refresh(id);
    } catch (reason) {
      const code = (reason as { code?: string }).code;
      if (code && ["SCRIPT_VIDEO_PREVIEW_EXPIRED", "SCRIPT_VIDEO_INVALID_PREVIEW", "SCRIPT_VIDEO_KIE_KEY_REQUIRED", "SCRIPT_VIDEO_CONCURRENCY_LIMIT", "SCRIPT_VIDEO_REVIEW_LIMIT"].includes(code)) {
        remember(""); setTaskId(""); setVariant(null);
      } else setVariant({ ...initial(id), status: "review", error: tr("提交结果待核实，请查询此任务，勿重复创建。", "Submission unconfirmed. Retrieve this task; do not submit again.") });
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { lock.current = false; setBusy(false); }
  }
  function reset() {
    if (variant && !["completed", "failed"].includes(variant.status)) return;
    remember(""); setTaskId(""); setVariant(null); setPreview(null); setError("");
  }
  return { preview, variant, taskId, busy, error, storageError, prepare, submit, refresh, reset };
}
