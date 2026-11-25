"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Film, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenerationTaskProgress } from "@/components/reference-video/generation-task-progress";
import { useScriptVideo } from "./use-script-video";
import { SCRIPT_VIDEO_PROMPT_LIMIT, SCRIPT_VIDEO_REVIEW_LIMIT, type ScriptVideoSettings } from "@/lib/workflow/script-video-compiler";

export function ScriptVideoPanel({ projectId, versionId, revision, language, expiresAt, dirty, onClose }: {
  projectId: string; versionId: string; revision: number; language: "zh" | "en"; expiresAt?: string; dirty: boolean; onClose: () => void;
}) {
  const zh = language === "zh", tr = (cn: string, en: string) => zh ? cn : en;
  const [settings, setSettings] = useState<ScriptVideoSettings>({ duration: 30, resolution: "720p", aspectRatio: "16:9", generateAudio: false });
  const [prompt, setPrompt] = useState("");
  const [edited, setEdited] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const flow = useScriptVideo(projectId, versionId, revision, language, expiresAt);
  useEffect(() => { rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);
  const preview = flow.preview;
  const valid = Boolean(preview && preview.snapshot.revision === revision && JSON.stringify(preview.snapshot.settings) === JSON.stringify(settings) && prompt === preview.snapshot.prompt && prompt.length <= SCRIPT_VIDEO_REVIEW_LIMIT && Date.now() < preview.snapshot.expiresAt);
  function changeSettings(next: ScriptVideoSettings) { setSettings(next); setConfirmed(false); }
  async function prepare(fromScript = false) {
    const result = await flow.prepare(settings, !fromScript && edited ? prompt : undefined);
    if (result) { setPrompt(result.snapshot.prompt); setEdited(false); setConfirmed(false); }
  }
  const selectClass = "mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-50";
  return <section ref={rootRef} aria-label={tr("完整脚本生成长视频", "Generate full-script video")} className="mt-6 scroll-mt-20 rounded-xl border border-primary/25 bg-background p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h4 className="flex items-center gap-2 font-semibold"><Film className="h-4 w-4 text-primary" />{tr("完整脚本 → 长视频", "Full script → video")}</h4>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Seedance 2.5 · KIE · {tr("实验性 / 自带 Key", "Experimental / own API key")}</p></div>
      <button type="button" onClick={onClose} aria-label={tr("关闭长视频面板", "Close video panel")} className="rounded-md p-2 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X className="h-4 w-4" /></button>
    </div>
    {flow.error && <p role="alert" className="mt-4 break-words rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{flow.error}</p>}
    {flow.storageError && <p role="alert" className="mt-3 text-xs text-amber-700">{tr("本机任务恢复记录无法保存，请保持页面打开，并记下任务编号。", "Local task storage is unavailable. Keep this page open and note the task ID.")}</p>}
    {!flow.taskId ? <>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-xs text-muted-foreground">{tr("视频时长", "Duration")}<select aria-label={tr("长视频时长", "Video duration")} className={selectClass} value={settings.duration} disabled={flow.busy} onChange={event => changeSettings({ ...settings, duration: Number(event.target.value) })}>
          {Array.from({ length: 27 }, (_, i) => i + 4).map(n => <option key={n} value={n}>{n} {tr("秒", "seconds")}</option>)}
        </select></label>
        <label className="min-w-0 text-xs text-muted-foreground">{tr("分辨率", "Resolution")}<select aria-label={tr("长视频分辨率", "Video resolution")} className={selectClass} value={settings.resolution} disabled={flow.busy} onChange={event => changeSettings({ ...settings, resolution: event.target.value as ScriptVideoSettings["resolution"] })}>{["480p", "720p", "1080p"].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="min-w-0 text-xs text-muted-foreground">{tr("画幅", "Aspect ratio")}<select aria-label={tr("长视频画幅", "Video aspect ratio")} className={selectClass} value={settings.aspectRatio} disabled={flow.busy} onChange={event => changeSettings({ ...settings, aspectRatio: event.target.value as ScriptVideoSettings["aspectRatio"] })}>{["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].map(v => <option key={v}>{v}</option>)}</select></label>
      </div>
      <label className="mt-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={settings.generateAudio} disabled={flow.busy} onChange={event => changeSettings({ ...settings, generateAudio: event.target.checked })} className="h-4 w-4 accent-primary" />{tr("生成同步声音", "Generate synchronized audio")}</label>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{tr("根据已保存脚本整理提示词，保留原镜头时间点；预览不调用 AI、不消耗改写次数。模型切镜时间及角色一致性需以实际结果为准。", "Compile the saved script with its original shot timing. Preview uses no AI call or rewrite allowance. Exact cuts and character consistency depend on the model.")}</p>
      {dirty && <p className="mt-2 text-xs text-amber-700">{tr("脚本尚未保存，请先完成保存。", "Save the script before previewing.")}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={flow.busy || dirty} onClick={() => void prepare()}>{flow.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{preview ? tr("更新提示词预览", "Update prompt preview") : tr("生成提示词预览", "Preview prompt")}</Button>
        {preview && <Button type="button" variant="ghost" size="sm" disabled={flow.busy || dirty} onClick={() => void prepare(true)}>{tr("从当前脚本重新整理", "Recompile current script")}</Button>}
      </div>
      {preview && <div className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{tr("实际提交提示词", "Actual generation prompt")} · {tr("脚本修订", "Script revision")} {preview.snapshot.revision}</span><span>{prompt.length.toLocaleString()} / {SCRIPT_VIDEO_PROMPT_LIMIT.toLocaleString()}</span></div>
        <textarea aria-label={tr("长视频实际提示词", "Actual video prompt")} value={prompt} onChange={event => { setPrompt(event.target.value); setEdited(true); setConfirmed(false); }} rows={12} disabled={flow.busy}
          className="block w-full min-w-0 resize-y rounded-lg border border-border bg-background p-3 text-sm leading-7 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10" />
        {prompt.length > SCRIPT_VIDEO_REVIEW_LIMIT && <p className="text-xs text-amber-700">{tr("当前安全审核最多支持 10,000 字符，请在此精简生成提示词后更新预览；完整脚本不会被截断或修改。", "Current safety review accepts 10,000 characters. Shorten this generation prompt and update the preview. The full script is preserved.")}</p>}
        {!valid && <p className="text-xs text-amber-700">{tr("脚本、提示词或参数已有变化，或预览已过期，请更新预览后再确认。", "The script, prompt or parameters changed, or the preview expired. Update it before confirming.")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } }}>{copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}{copied ? tr("已复制", "Copied") : tr("复制提示词", "Copy prompt")}</Button>
          <details className="min-w-0 flex-1 text-xs text-muted-foreground"><summary className="cursor-pointer">{tr("查看实际请求参数", "View actual request parameters")}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-3">{JSON.stringify(preview.payload, null, 2)}</pre></details>
        </div>
        <div className="rounded-lg border border-border p-3 text-sm leading-6">
          <p className="font-medium">{tr("生成确认", "Generation confirmation")}</p>
          <p className="mt-1">{settings.duration}s · {settings.resolution} · {settings.aspectRatio} · {settings.generateAudio ? tr("有声", "Audio") : tr("无声", "Silent")} · {tr("1 段视频", "1 video")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tr("本次调用费用由你的 KIE 账户承担，平台不扣积分。金额以 KIE 当前费率及实际结算为准。", "Billed to your KIE account at its current rates. No platform credits are charged.")} <a href="https://kie.ai/pricing" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{tr("查看 KIE 价格", "KIE pricing")}</a></p>
          {!preview.canGenerate && <p className="mt-2 text-amber-700">{tr("请先在设置中保存自己的 KIE API Key。", "Configure your own KIE API key in settings first.")} <a href="/dashboard?tab=settings" className="underline">{tr("前往设置", "Open settings")}</a></p>}
          <label className="mt-3 flex items-start gap-2"><input aria-label={tr("确认 KIE 费用", "Confirm KIE charges")} type="checkbox" checked={confirmed} disabled={!valid || !preview.canGenerate || flow.busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" /><span className="text-xs">{tr("我已核对参数和 KIE 计费，确认调用模型生成这段视频。", "I have reviewed these parameters and KIE charges and confirm this generation.")}</span></label>
          <Button type="button" className="mt-4 max-w-full" disabled={!valid || !confirmed || !preview.canGenerate || flow.busy || dirty} onClick={() => void flow.submit()}>{flow.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}{tr(`确认生成 ${settings.duration} 秒视频`, `Generate ${settings.duration}-second video`)}</Button>
        </div>
      </div>}
    </> : <div className="mt-4">
      <p className="break-all font-mono text-xs text-muted-foreground">{tr("任务编号", "Task ID")}: {flow.taskId}</p>
      {flow.variant && <GenerationTaskProgress variant={flow.variant} zh={zh} />}
      {flow.variant?.status === "completed" && flow.variant.videoUrl && <div className="mt-4"><video controls playsInline src={flow.variant.videoUrl} className="w-full rounded-lg bg-black" /><a href={flow.variant.videoUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-primary underline underline-offset-4">{tr("打开或下载生成视频", "Open or download video")}</a></div>}
      <div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={flow.busy} onClick={() => void flow.refresh()}><RefreshCw className="mr-2 h-3.5 w-3.5" />{tr("查询当前任务", "Retrieve current task")}</Button>
        {flow.variant && ["completed", "failed"].includes(flow.variant.status) && <Button type="button" variant="ghost" size="sm" onClick={() => { flow.reset(); setPrompt(""); setConfirmed(false); setEdited(false); }}>{tr("准备新的生成", "Prepare another video")}</Button>}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{tr("任务已绑定提交时的脚本修订。刷新页面后打开此面板可恢复查询，也可在生成历史中查看已提交的任务。", "This task uses the frozen script revision. Reopen this panel after a reload to retrieve it, or use generation history.")}</p>
    </div>}
  </section>;
}
