"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Download, Loader2, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFullVideoScript } from "./use-full-video-script";
import { scriptTime, type FullVideoScript } from "@/lib/workflow/full-video-script";

function ScriptField({ label, value, onChange, disabled, title = false }: {
  label: string; value: string; onChange: (value: string) => void; disabled: boolean; title?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const resize = () => { if (ref.current) { ref.current.style.height = "0px"; ref.current.style.height = `${ref.current.scrollHeight + 2}px`; } };
    resize();
    const observer = new ResizeObserver(resize);
    if (ref.current?.parentElement) observer.observe(ref.current.parentElement);
    return () => observer.disconnect();
  }, [value]);
  return <label className="block min-w-0">
    <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
    <textarea ref={ref} aria-label={label} rows={1} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
      className={`block min-h-10 w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-2 leading-7 text-foreground transition-colors hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60 ${title ? "text-lg font-semibold" : "text-sm"}`} />
  </label>;
}

export function FullVideoScriptPanel({ projectId, versionId, language, preview, partial, commercialEnabled, remainingRewrites, hasUserApiKey, onDirtyChange }: {
  projectId: string; versionId: string; language: "zh" | "en"; preview: ReactNode; partial: boolean;
  commercialEnabled: boolean; remainingRewrites: number; hasUserApiKey: boolean; onDirtyChange?: (dirty: boolean) => void;
}) {
  const zh = language === "zh";
  const text = (cn: string, en: string) => zh ? cn : en;
  const [expanded, setExpanded] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [payer, setPayer] = useState<"included" | "byok">(commercialEnabled ? "included" : "byok");
  const panelId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const script = useFullVideoScript(projectId, versionId, language, expanded);
  const draft = script.draft;
  const expansionKey = `promptlens:script-expanded:${projectId}:${versionId}`;
  useEffect(() => { try { setExpanded(localStorage.getItem(expansionKey) === "true"); } catch { /* Default collapsed. */ } }, [expansionKey]);
  useEffect(() => { onDirtyChange?.(script.dirty || script.busy); return () => onDirtyChange?.(false); }, [script.dirty, script.busy, onDirtyChange]);
  useEffect(() => {
    if (!formatOpen) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setFormatOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFormatOpen(false); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [formatOpen]);
  function toggle() { const next = !expanded; setExpanded(next); try { localStorage.setItem(expansionKey, String(next)); } catch { /* Keep in memory. */ } }
  const statuses = {
    loading: text("正在整理脚本…", "Preparing script…"), saved: text("已保存", "Saved"),
    unsaved: text("未保存", "Unsaved"), saving: text("保存中…", "Saving…"),
    failed: text("保存失败", "Save failed"), conflict: text("编辑冲突", "Editing conflict"),
  };
  const editField = (key: Exclude<keyof FullVideoScript, "scenes">, value: string) => { if (draft) script.edit({ ...draft, [key]: value }); };
  const effectivePayer = commercialEnabled ? payer : "byok";
  const cannotRewrite = effectivePayer === "included" ? !remainingRewrites : !hasUserApiKey;
  const selectedCandidate = script.candidate;
  const changes = draft && selectedCandidate ? [
    ...(["title", "summary", "globalStyle", "characters", "continuityNotes"] as const).map(key => ({
      label: ({ title: text("标题", "Title"), summary: text("整片解读", "Video interpretation"), globalStyle: text("全局风格", "Global style"), characters: text("角色", "Characters"), continuityNotes: text("连续性与分析说明", "Continuity and analysis notes") })[key],
      before: draft[key], after: selectedCandidate.content[key],
    })),
    ...draft.scenes.map((s, i) => ({ label: `${text("镜头", "Scene")} ${s.sceneIndex}`, before: s.text, after: selectedCandidate.content.scenes[i]?.text ?? s.text })),
  ].filter(change => change.before !== change.after) : [];

  return <div className="mt-3 min-w-0" data-testid="full-video-script">
    {!expanded && <div className="relative">
      <div className="max-h-40 overflow-hidden break-words text-sm leading-7 text-muted-foreground">{preview}</div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-background to-transparent" />
    </div>}
    <div className={`flex flex-wrap items-center justify-between gap-2 ${expanded ? "mb-5 border-b border-border pb-3" : "mt-3"}`}>
      <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={panelId}
        className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {expanded ? text("收起完整脚本", "Collapse full script") : text("展开完整脚本", "Expand full script")}
      </button>
      {expanded && script.document && <span role="status" className={`flex items-center gap-1.5 text-xs ${script.status === "conflict" || script.status === "failed" ? "text-amber-700" : "text-muted-foreground"}`}>
        {script.status === "saved" ? <Check className="h-3 w-3" /> : script.status === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {statuses[script.status]} · {text("修订", "Revision")} {script.document.revision}
      </span>}
    </div>
    <div id={panelId} hidden={!expanded}>
      {partial && <p className="mb-4 text-xs text-amber-700">{text("部分镜头分析未完成，脚本仅包含已有分析。", "Some scenes are incomplete. This script uses available analysis.")}</p>}
      {script.storageError && <p role="alert" className="mb-3 text-xs text-amber-700">{text("本机恢复稿暂时无法保存，请保持页面打开并及时导出。", "Local draft storage is unavailable. Keep this page open and export your work.")}</p>}
      {script.error && <div role="alert" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50/60 p-3 text-sm text-amber-900">
        <p className="break-words">{script.error}</p>
        {script.status !== "conflict" && !script.pending && <button type="button" className="mt-2 underline underline-offset-4" disabled={script.busy} onClick={() => void script.retry()}>{text("重试", "Retry")}</button>}
      </div>}
      {script.status === "conflict" && <div className="mb-4 rounded-lg border border-amber-500/30 p-3 text-sm">
        <p>{text("远端已有新修订，本机编辑稿已保留。请先复制本地文字或选择如何继续。", "A newer revision exists. Your local draft is preserved. Copy your text or choose how to continue.")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { if (window.confirm(text("放弃本机未保存修改，加载远端脚本？", "Discard local unsaved changes and load the server script?"))) void script.resolveConflict(false); }}>{text("加载远端稿", "Load server version")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { if (window.confirm(text("用当前本机稿覆盖远端最新内容？远端稿会保留为上一修订。", "Replace the latest server content with this local draft? The server version will remain in revision history."))) void script.resolveConflict(true); }}>{text("保留本机稿并保存", "Keep and save local draft")}</Button>
        </div>
      </div>}
      {!draft ? <p className="py-8 text-center text-sm text-muted-foreground">{script.status === "loading" ? statuses.loading : text("脚本暂不可用", "Script unavailable")}</p> : <>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_44px]">
          <div className="min-w-0 space-y-6" aria-label={text("完整脚本编辑器", "Full script editor")}>
            <ScriptField label={text("标题", "Title")} value={draft.title} disabled={script.busy} onChange={value => editField("title", value)} title />
            <ScriptField label={text("整片解读", "Video interpretation")} value={draft.summary} disabled={script.busy} onChange={value => editField("summary", value)} />
            <div className="grid min-w-0 gap-5 lg:grid-cols-2">
              <ScriptField label={text("全局风格", "Global style")} value={draft.globalStyle} disabled={script.busy} onChange={value => editField("globalStyle", value)} />
              <ScriptField label={text("角色与外观", "Characters and appearance")} value={draft.characters} disabled={script.busy} onChange={value => editField("characters", value)} />
            </div>
            {draft.scenes.map((scene, index) => <div key={scene.id} className="min-w-0 border-t border-border pt-5">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2">
                <h4 className="text-sm font-semibold">{text("镜头", "Scene")} {String(scene.sceneIndex).padStart(2, "0")}</h4>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{scriptTime(scene.startMs)} — {scriptTime(scene.endMs)}</span>
              </div>
              <ScriptField label={text(`镜头 ${scene.sceneIndex} 脚本`, `Scene ${scene.sceneIndex} script`)} value={scene.text} disabled={script.busy}
                onChange={value => script.edit({ ...draft, scenes: draft.scenes.map((s, i) => i === index ? { ...s, text: value } : s) })} />
            </div>)}
            <ScriptField label={text("连续性与分析说明", "Continuity and analysis notes")} value={draft.continuityNotes} disabled={script.busy} onChange={value => editField("continuityNotes", value)} />
          </div>
          <aside aria-label={text("脚本操作", "Script actions")} className="md:relative">
            <div ref={menuRef} className="relative flex flex-col items-start gap-2 md:sticky md:top-24">
              <div className="group relative">
                <button type="button" aria-label={text("导出完整脚本", "Export full script")} title={text("导出完整脚本", "Export full script")}
                  aria-expanded={formatOpen} aria-haspopup="true" disabled={script.busy || script.status === "conflict"}
                  onClick={() => setFormatOpen(value => !value)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40">
                  <Download className="h-[18px] w-[18px]" />
                </button>
                {!formatOpen && <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-max max-w-[200px] rounded-md bg-foreground px-3 py-2 text-xs text-background shadow-sm group-hover:block group-focus-within:block">{text("导出完整脚本", "Export full script")}</span>}
              </div>
              {formatOpen && <div aria-label={text("导出格式", "Export format")} className="absolute left-0 top-12 z-30 min-w-40 rounded-lg border border-border bg-background p-1.5 shadow-md md:left-auto md:right-0">
                <p className="px-2 py-1 text-xs text-muted-foreground">{text("导出已保存的完整脚本", "Export the saved full script")}</p>
                {(["md", "txt", "json"] as const).map(format => <button key={format} type="button" onClick={() => { setFormatOpen(false); void script.download(format); }} className="block min-h-10 w-full rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{format === "md" ? "Markdown (.md)" : format === "txt" ? text("纯文本 (.txt)", "Plain text (.txt)") : "JSON (.json)"}</button>)}
              </div>}
            </div>
          </aside>
        </div>
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{text("用 AI 改写脚本", "Rewrite with AI")}</h4>
            <Button type="button" variant="ghost" size="sm" disabled={script.busy || script.dirty || !script.document?.history.length} onClick={() => void script.apply("undo")}><Undo2 className="mr-1.5 h-3.5 w-3.5" />{text("恢复上一修订", "Restore previous revision")}</Button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <select aria-label={text("脚本改写范围", "Script rewrite scope")} value={scope} disabled={script.busy || Boolean(script.pending)} onChange={event => setScope(event.target.value === "selected" ? "selected" : "all")} className="min-h-10 max-w-full rounded-lg border border-border bg-background px-2 text-sm">
              <option value="all">{text("整篇脚本", "Whole script")}</option><option value="selected">{text("指定镜头", "Selected scenes")}</option>
            </select>
            <select aria-label={text("脚本改写费用来源", "Script rewrite payment source")} value={effectivePayer} disabled={script.busy || Boolean(script.pending)} onChange={event => setPayer(event.target.value === "byok" ? "byok" : "included")} className="min-h-10 max-w-full rounded-lg border border-border bg-background px-2 text-sm">
              {commercialEnabled && <option value="included">{text("套餐改写额度", "Included rewrites")} · {remainingRewrites}</option>}
              <option value="byok" disabled={!hasUserApiKey}>{text("自带 API Key", "Own API key")}</option>
            </select>
            <span className="leading-5 text-muted-foreground">{effectivePayer === "included" ? text("成功生成候选消耗 1 次，不另扣积分", "1 rewrite per successful candidate, no extra credits") : text("调用费用由你的供应商账户承担", "Calls are billed to your provider account")}</span>
          </div>
          {scope === "selected" && <fieldset className="mb-3 flex flex-wrap gap-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">{text("仅修改勾选镜头", "Only rewrite checked scenes")}</legend>
            {draft.scenes.map(scene => <label key={scene.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={sceneIds.includes(scene.id)} disabled={script.busy || Boolean(script.pending)} onChange={event => setSceneIds(ids => event.target.checked ? [...ids, scene.id] : ids.filter(id => id !== scene.id))} className="h-4 w-4 accent-primary" />{text("镜头", "Scene")} {scene.sceneIndex}</label>)}
          </fieldset>}
          <form onSubmit={event => { event.preventDefault(); void script.rewrite(instruction.trim(), scope === "all" ? [] : sceneIds, effectivePayer); }} className="rounded-xl border border-border bg-background p-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <textarea aria-label={text("完整脚本 AI 改写要求", "Full script AI rewrite instructions")} value={instruction} maxLength={8000} disabled={script.busy || Boolean(script.pending)} onChange={event => setInstruction(event.target.value)} rows={3}
              placeholder={text("告诉 AI 你想如何修改，例如：只把第二镜头的背景改成雪原，保持角色、运镜和其他镜头不变。", "Tell AI what to change, e.g. set scene 2 in a snowfield and preserve the characters, camera and other scenes.")}
              className="w-full resize-y border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-5 text-muted-foreground">{script.pending ? text("请求已记录，继续查询使用同一请求，不重复扣次数。", "This request is recorded. Retrieve it with the same ID without another charge.") : text("AI 先给出建议，确认应用后才修改脚本。", "Review AI suggestions before applying changes.")}</p>
              <Button type="submit" size="sm" disabled={script.busy || script.status === "conflict" || (!script.pending && (!instruction.trim() || cannotRewrite || scope === "selected" && !sceneIds.length))}>
                {script.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}{script.busy ? text("处理中…", "Processing…") : script.pending ? text("查询改写结果", "Retrieve rewrite") : text("发送改写要求", "Send rewrite")}
              </Button>
            </div>
          </form>
          {selectedCandidate && <div className="mt-4 rounded-lg border border-primary/25 bg-primary/[0.025] p-4" aria-label={text("AI 修改建议", "AI suggestions")}>
            <h4 className="text-sm font-semibold">{text("AI 修改建议", "AI suggestions")}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{text("下方展示发生变化的内容，当前脚本尚未修改。", "Changed sections are shown below. Your current script is unchanged.")}</p>
            {changes.map((change, i) => <details key={i} open className="mt-4 min-w-0">
              <summary className="cursor-pointer text-sm font-medium">{change.label}</summary>
              <div className="mt-2 grid min-w-0 gap-2 lg:grid-cols-2">
                <div className="min-w-0 rounded-md bg-rose-50/70 p-3"><p className="mb-2 text-xs font-medium text-rose-800">{text("修改前", "Before")}</p><p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{change.before || text("（空）", "(empty)")}</p></div>
                <div className="min-w-0 rounded-md bg-emerald-50/70 p-3"><p className="mb-2 text-xs font-medium text-emerald-800">{text("AI 建议", "AI suggestion")}</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{change.after || text("（空）", "(empty)")}</p></div>
              </div>
            </details>)}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={script.busy || script.dirty || selectedCandidate.sourceRevision !== script.document?.revision} onClick={() => void script.apply("apply")}>{text("应用修改", "Apply changes")}</Button>
              <Button type="button" variant="outline" size="sm" disabled={script.busy} onClick={script.reject}>{text("拒绝建议", "Reject suggestion")}</Button>
            </div>
            {selectedCandidate.sourceRevision !== script.document?.revision && <p className="mt-2 text-xs text-amber-700">{text("脚本已有新修订，此建议已过期。请拒绝后基于当前脚本重新改写。", "The script has changed. Reject this stale suggestion and rewrite the current revision.")}</p>}
          </div>}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{text("脚本与原分镜独立保存；编辑不消耗视频生成额度。内容沿用 7 天保留规则，请及时导出。", "Saved separately from the original scenes. Editing uses no video generation allowance. Content follows the 7-day retention policy; export it in time.")}</p>
        </div>
      </>}
    </div>
  </div>;
}
