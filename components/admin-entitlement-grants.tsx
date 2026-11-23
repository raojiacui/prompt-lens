"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Pack = { id: string; name: string; credits: number; rewrites: number; linkImports: number };
type RecordRow = { id: string; email: string; credits: number; rewrites: number; createdAt: string; expiresAt: string;
  state: string; availableCredits: number; availableRewrites: number;
  metadata: { packageId: string; linkImports: number; note: string } };
const initial = { email: "", packageId: "v6_trial_200", credits: 200, rewrites: 20, linkImports: 12, days: 7, note: "" };
export function AdminEntitlementGrants() {
  const [draft, setDraft] = useState(initial);
  const [packages, setPackages] = useState<Pack[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Retain the same immutable request after a network error; a fresh intentional grant gets a new ID.
  const pending = useRef<{ id: string; draft: typeof initial } | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/entitlements", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "发放记录加载失败");
    setPackages(data.packages); setRecords(data.records); setLoaded(true);
  }, []);
  useEffect(() => { void refresh().catch(error => setError(error.message)); }, [refresh]);
  function selectPackage(id: string) {
    const pack = packages.find(pack => pack.id === id);
    setDraft(current => ({ ...current, packageId: id, ...(pack ? { credits: pack.credits, rewrites: pack.rewrites, linkImports: pack.linkImports } : {}) }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const request = pending.current || { id: crypto.randomUUID(), draft: { ...draft } };
    pending.current = request;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/entitlements", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request.draft, grantId: request.id }) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) pending.current = null; throw new Error(data.error || "发放失败"); }
      pending.current = null;
      setSuccess(`${data.email}：${data.created ? "权益已发放" : "该笔权益已发放，无需重复操作"}，到期时间 ${new Date(data.expiresAt).toLocaleString()}`);
      setDraft(current => ({ ...current, email: "", note: "" }));
      try { await refresh(); } catch { setError("权益已发放，记录刷新失败，请刷新记录。"); }
    } catch (error) { setError(error instanceof Error ? error.message : "请求失败，请重试同一笔发放"); }
    finally { setBusy(false); }
  }
  const field = "w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-base)] px-3 py-2";
  return <section className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5">
    <h2 className="text-lg font-semibold">发放体验权益</h2>
    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">对方需先注册。有效期从发放时开始，到期清除本次赠送的未用权益。</p>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <fieldset disabled={busy || !!pending.current} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
        <label className="space-y-1 text-sm"><span>用户邮箱</span><input className={field} type="email" required maxLength={254} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="已注册的邮箱" /></label>
        <label className="space-y-1 text-sm"><span>发放权益</span><select className={field} value={draft.packageId} disabled={!loaded} onChange={e => selectPackage(e.target.value)}>{packages.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}<option value="custom">自定义权益</option></select></label>
        <label className="space-y-1 text-sm"><span>有效期</span><select className={field} value={draft.days} onChange={e => setDraft({ ...draft, days: Number(e.target.value) })}>{[1,7,30].map(day => <option key={day} value={day}>{day} 天</option>)}</select></label>
        {([ ["credits", "通用积分", 100000], ["rewrites", "AI 改写次数", 10000], ["linkImports", "链接导入次数", 10000] ] as const).map(([key,label,max]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span><input className={field} type="number" min={0} max={max} step={1} required readOnly={draft.packageId !== "custom"} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} /></label>)}
        <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-3"><span>备注（选填）</span><input className={field} maxLength={500} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="例如：朋友体验、合作试用" /></label>
      </fieldset>
      {pending.current && !busy && <p className="text-sm text-amber-700">上次结果尚未确认。重试会核对同一笔发放，不会重复到账。</p>}
      <Button type="submit" disabled={busy || !loaded}>{busy ? "正在发放…" : pending.current ? "重试同一笔发放" : "发放权益"}</Button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {success && <p role="status" className="mt-3 text-sm text-emerald-700">{success}</p>}
    <div className="mt-6 flex items-center justify-between gap-3"><h3 className="font-medium">最近发放记录</h3><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh().catch(error => setError(error.message))}>刷新记录</Button></div>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
      <thead><tr className="border-b">{["邮箱", "发放权益", "剩余积分 / 改写", "到期时间", "状态", "备注"].map(label => <th key={label} className="pb-2 pr-4 font-medium">{label}</th>)}</tr></thead>
      <tbody>{records.map(row => { const expired = new Date(row.expiresAt).getTime() <= Date.now(); return <tr key={row.id} className="border-b border-[var(--color-border-default)]"><td className="py-3 pr-4">{row.email}<p className="text-xs text-[var(--color-text-secondary)]">{new Date(row.createdAt).toLocaleString()}</p></td><td className="py-3 pr-4">{row.credits} 积分 · {row.rewrites} 次改写 · {row.metadata.linkImports} 次导入</td><td className="py-3 pr-4">{expired ? 0 : row.availableCredits} / {expired ? 0 : row.availableRewrites}</td><td className="py-3 pr-4">{new Date(row.expiresAt).toLocaleString()}</td><td className="py-3 pr-4">{expired ? "已到期" : "有效"}</td><td className="max-w-48 break-words py-3 pr-4">{row.metadata.note || "—"}</td></tr>; })}{loaded && !records.length && <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-secondary)]">暂无发放记录</td></tr>}</tbody>
    </table></div>
  </section>;
}
