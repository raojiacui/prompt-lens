"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithSessionRefresh } from "@/lib/auth/session-fetch";
import { scriptContentSchema, validateScriptBoundaries, type FullVideoScript, type ScriptCandidate, type ScriptDocument } from "@/lib/workflow/full-video-script";

type RewriteRequest = { versionId: string; revision: number; requestId: string; instruction: string; sceneIds: string[]; language: "zh" | "en"; payer: "included" | "byok" };
type Status = "loading" | "saved" | "unsaved" | "saving" | "failed" | "conflict";
type State = { document: ScriptDocument | null; draft: FullVideoScript | null; dirty: boolean; status: Status };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useFullVideoScript(projectId: string, versionId: string, language: "zh" | "en", enabled: boolean) {
  const url = `/api/workflow/projects/${encodeURIComponent(projectId)}/script`;
  const storageKey = `promptlens:script:${projectId}:${versionId}`;
  const [state, setState] = useState<State>({ document: null, draft: null, dirty: false, status: "loading" });
  const stateRef = useRef(state);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [candidate, setCandidate] = useState<ScriptCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<RewriteRequest | null>(null);
  const flight = useRef<Promise<boolean> | null>(null);
  const actionLock = useRef(false);
  const loaded = useRef(false);
  const active = useRef(true);
  const update = useCallback((next: State) => { stateRef.current = next; if (active.current) setState(next); }, []);
  const message = (zh: string, en: string) => language === "zh" ? zh : en;

  function store(key: string, value: unknown) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); }
    catch { setStorageError(true); }
  }
  async function readResponse(response: Response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = new Error(body?.error || message("脚本请求失败", "Script request failed")) as Error & { conflict?: boolean; final?: boolean };
      failure.conflict = body?.code === "SCRIPT_CONFLICT"; failure.final = body?.final === true;
      throw failure;
    }
    return body;
  }
  function keepDraft(content: FullVideoScript, document: ScriptDocument) {
    store(storageKey, { revision: document.revision, content, expiresAt: document.expiresAt || new Date(Date.now() + 7 * 86400000).toISOString() });
  }
  async function load(restore = true) {
    setError("");
    try {
      const document = await readResponse(await fetchWithSessionRefresh(`${url}?versionId=${versionId}&language=${language}`, { cache: "no-store" })) as ScriptDocument;
      if (!active.current) return;
      let draft = document.content;
      let dirty = false;
      let conflict = false;
      if (restore) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
          if (saved && new Date(saved.expiresAt).getTime() > Date.now()) {
            const content = scriptContentSchema.parse(saved.content);
            validateScriptBoundaries(document.content, content);
            if (!same(content, document.content)) { draft = content; dirty = true; conflict = saved.revision !== document.revision; }
          } else if (saved) localStorage.removeItem(storageKey);
          const pendingRequest = JSON.parse(localStorage.getItem(`${storageKey}:pending`) || "null");
          if (pendingRequest?.request && new Date(pendingRequest.expiresAt).getTime() > Date.now()) setPending(pendingRequest.request);
          else localStorage.removeItem(`${storageKey}:pending`);
        } catch { setStorageError(true); }
      }
      update({ document, draft, dirty, status: conflict ? "conflict" : dirty ? "unsaved" : "saved" });
      let dismissed: string[] = [];
      try { const saved = JSON.parse(localStorage.getItem(`${storageKey}:dismissed`) || "null"); if (saved?.expiresAt > Date.now()) dismissed = saved.ids || []; } catch { /* Candidate can still be reviewed. */ }
      setCandidate([...document.candidates].reverse().find(c => c.sourceRevision === document.revision && !dismissed.includes(c.requestId)) || null);
      if (!dirty) store(storageKey, null);
    } catch (reason) {
      if (active.current) { setError(reason instanceof Error ? reason.message : String(reason)); update({ ...stateRef.current, status: "failed" }); }
    }
  }
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (enabled && !loaded.current) { loaded.current = true; void load(); }
    // A panel is keyed by project/version; collapse never replaces its local draft.
  }, [enabled]);

  function edit(draft: FullVideoScript) {
    const current = stateRef.current;
    if (!current.document) return;
    const dirty = !same(draft, current.document.content);
    keepDraft(draft, current.document);
    update({ ...current, draft, dirty, status: current.status === "conflict" ? "conflict" : dirty ? "unsaved" : "saved" });
  }
  async function flush(): Promise<boolean> {
    if (flight.current) return flight.current;
    const current = stateRef.current;
    if (!current.dirty) return Boolean(current.document);
    if (!current.document || !current.draft || current.status === "conflict") return false;
    const snapshot = current.draft;
    update({ ...current, status: "saving" }); setError("");
    const task = (async () => {
      try {
        const document = await readResponse(await fetchWithSessionRefresh(url, { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", versionId, revision: current.document!.revision, content: snapshot }) })) as ScriptDocument;
        const latest = stateRef.current;
        const dirty = !same(latest.draft, snapshot);
        update({ document, draft: dirty ? latest.draft : document.content, dirty, status: dirty ? "unsaved" : "saved" });
        if (dirty && latest.draft) keepDraft(latest.draft, document); else store(storageKey, null);
        return !dirty;
      } catch (reason) {
        const failure = reason as Error & { conflict?: boolean };
        if (active.current) setError(failure.message);
        update({ ...stateRef.current, status: failure.conflict ? "conflict" : "failed" });
        return false;
      } finally { flight.current = null; }
    })();
    flight.current = task;
    return task;
  }
  useEffect(() => {
    if (!state.dirty || state.status !== "unsaved") return;
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [state.draft, state.status, state.document?.revision]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (stateRef.current.dirty || actionLock.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function apply(action: "apply" | "undo") {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    try {
      if (!await flush()) return;
      const current = stateRef.current.document!;
      const document = await readResponse(await fetchWithSessionRefresh(url, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, versionId, revision: current.revision, ...(action === "apply" ? { candidateId: candidate?.requestId } : {}) }) })) as ScriptDocument;
      update({ document, draft: document.content, dirty: false, status: "saved" });
      setCandidate(null); store(storageKey, null);
    } catch (reason) {
      const failure = reason as Error & { conflict?: boolean };
      if (failure.conflict) update({ ...stateRef.current, status: "conflict" });
      setError(failure.message);
    } finally { setBusy(false); actionLock.current = false; }
  }
  async function rewrite(instruction: string, sceneIds: string[], payer: "included" | "byok") {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    try {
      if (!pending && !await flush()) return;
      const request: RewriteRequest = pending || { versionId, revision: stateRef.current.document!.revision, requestId: crypto.randomUUID(), instruction, sceneIds, language, payer };
      setPending(request);
      store(`${storageKey}:pending`, { request, expiresAt: stateRef.current.document?.expiresAt || new Date(Date.now() + 7 * 86400000).toISOString() });
      const body = await readResponse(await fetchWithSessionRefresh(`${url}/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }));
      setCandidate(body.candidate); setPending(null); store(`${storageKey}:pending`, null);
      window.dispatchEvent(new Event("credits-updated"));
    } catch (reason) {
      const failure = reason as Error & { final?: boolean };
      if (failure.final) { setPending(null); store(`${storageKey}:pending`, null); }
      setError(failure.message);
    } finally { setBusy(false); actionLock.current = false; window.dispatchEvent(new Event("credits-updated")); }
  }
  function reject() {
    if (candidate) {
      let ids: string[] = [];
      try { ids = JSON.parse(localStorage.getItem(`${storageKey}:dismissed`) || "null")?.ids || []; } catch { /* Keep this dismissal. */ }
      store(`${storageKey}:dismissed`, { ids: [...ids, candidate.requestId].slice(-10), expiresAt: Date.now() + 7 * 86400000 });
    }
    setCandidate(null);
  }
  async function resolveConflict(keepLocal: boolean) {
    if (actionLock.current) return;
    if (!keepLocal) { store(storageKey, null); await load(false); return; }
    setError("");
    try {
      const document = await readResponse(await fetchWithSessionRefresh(`${url}?versionId=${versionId}&language=${language}`, { cache: "no-store" })) as ScriptDocument;
      validateScriptBoundaries(document.content, stateRef.current.draft!);
      keepDraft(stateRef.current.draft!, document);
      update({ ...stateRef.current, document, dirty: true, status: "unsaved" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function download(format: "md" | "txt" | "json") {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    try {
      if (!await flush()) return;
      const document = stateRef.current.document!;
      const response = await fetchWithSessionRefresh(`${url}?versionId=${versionId}&revision=${document.revision}&language=${language}&format=${format}`, { cache: "no-store" });
      if (!response.ok) { await readResponse(response); return; }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = objectUrl; anchor.download = `full-video-script-r${document.revision}.${format}`;
      window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); actionLock.current = false; }
  }
  return { ...state, error, storageError, candidate, busy, pending, edit, flush, apply, rewrite, reject, download, retry: () => state.document ? flush() : load(), resolveConflict };
}
