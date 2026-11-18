"use client";

import { useCallback, useEffect, useState } from "react";

type Term = {
  id: string; phrase: string; category: string; action: "block" | "review";
  enabled: boolean; revision: number; updatedAt: string; note: string | null;
};
type RecordRow = {
  id: string; stage: string; provider: string; verdict: string; category: string | null;
  reasonCode: string | null; taskId: string | null; createdAt: string;
  reviewerId: string | null; reviewNote: string | null;
};
const categories = [
  ["nsfw", "色情"], ["child_safety", "儿童安全"], ["ip", "版权/商标"],
  ["violence", "暴力"], ["hate", "仇恨"], ["self_harm", "自伤"],
  ["deepfake", "深度伪造"], ["public_figures", "公众人物"], ["other", "其他"],
];
const blank = { phrase: "", category: "deepfake", decision: "review", enabled: true, note: "" };

export function AdminModerationControls() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  const [editId, setEditId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState("");
  const [reviewVerdict, setReviewVerdict] = useState("escalated");
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/moderation", { cache: "no-store" });
    if (!response.ok) throw Error(response.status === 404 ? "当前部署未启用内容审核管理" : "审核记录读取失败，请检查权限和数据库连接");
    const data = await response.json() as { terms: Term[]; records: RecordRow[] };
    setTerms(data.terms); setRecords(data.records);
  }, []);
  useEffect(() => {
    let active = true;
    void refresh().catch(error => { if (active) setError(String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const send = async (body: object) => {
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/admin/moderation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || "保存失败");
      await refresh();
      return true;
    } catch (error) { setError(String(error)); return false; }
    finally { setBusy(false); }
  };
  const edit = (term: Term) => {
    setEditId(term.id); setDraft({ phrase: term.phrase, category: term.category,
      decision: term.action, enabled: term.enabled, note: term.note || "" });
  };
  return <section className="mt-6 space-y-4 rounded-xl border border-border bg-background p-4">
    <header>
      <h2 className="text-lg font-semibold">内容审核 · 违禁词与审计记录</h2>
      <p className="mt-1 text-xs text-muted-foreground">动态规则更新立即生效，所有修改留痕。原始提示词及生成视频不写入审计日志。人工复核记录不会自动放行视频。</p>
    </header>
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p className="text-sm">正在读取审核记录…</p> : <>
      <form className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async event => {
        event.preventDefault();
        if (await send({ action: "save_term", id: editId || undefined, ...draft })) {
          setEditId(null); setDraft({ ...blank });
        }
      }}>
        <label className="text-xs">违禁词或短语<input required minLength={2} maxLength={160} className="mt-1 w-full rounded-md border bg-background p-2" value={draft.phrase} onChange={e => setDraft({ ...draft, phrase: e.target.value })} /></label>
        <label className="text-xs">风险分类<select className="mt-1 w-full rounded-md border bg-background p-2" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs">处理方式<select className="mt-1 w-full rounded-md border bg-background p-2" value={draft.decision} onChange={e => setDraft({ ...draft, decision: e.target.value })}><option value="review">待人工复核</option><option value="block">直接拦截</option></select></label>
        <label className="text-xs">规则状态<select className="mt-1 w-full rounded-md border bg-background p-2" value={draft.enabled ? "on" : "off"} onChange={e => setDraft({ ...draft, enabled: e.target.value === "on" })}><option value="on">启用</option><option value="off">停用</option></select></label>
        <label className="text-xs sm:col-span-2">调整依据<input maxLength={500} placeholder="建议记录规则来源、版本及原因" className="mt-1 w-full rounded-md border bg-background p-2" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
        <div className="flex items-end gap-2 lg:col-span-2">
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50">{editId ? "保存修订" : "添加规则"}</button>
          {editId && <button type="button" className="rounded-md border px-3 py-2 text-xs" onClick={() => { setEditId(null); setDraft({ ...blank }); }}>取消编辑</button>}
        </div>
      </form>
      <div className="max-h-80 overflow-auto rounded-lg border">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="sticky top-0 bg-muted"><tr>{["短语", "分类", "处理", "状态", "修订", "操作"].map(x => <th className="px-3 py-2" key={x}>{x}</th>)}</tr></thead>
          <tbody>{terms.map(term => <tr className="border-t" key={term.id}>
            <td className="px-3 py-2">{term.phrase}</td><td className="px-3 py-2">{term.category}</td><td className="px-3 py-2">{term.action}</td>
            <td className="px-3 py-2">{term.enabled ? "启用" : "停用"}</td><td className="px-3 py-2">v{term.revision}</td>
            <td className="px-3 py-2"><div className="flex gap-3">
              <button type="button" disabled={busy} className="underline disabled:opacity-50" onClick={() => edit(term)}>编辑</button>
              <button type="button" disabled={busy} className="text-destructive underline disabled:opacity-50" aria-label={`删除规则：${term.phrase}`} onClick={async () => {
                if (!window.confirm(`确定删除规则“${term.phrase}”？删除后该词不再参与拦截，历史审核记录会保留。`)) return;
                if (await send({ action: "delete_term", id: term.id }) && editId === term.id) {
                  setEditId(null); setDraft({ ...blank });
                }
              }}>删除</button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">最近审核与人工复核记录</h3>
        <div className="max-h-80 overflow-auto rounded-lg border">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="sticky top-0 bg-muted"><tr>{["时间", "环节", "审核服务", "结果", "分类/原因", "操作"].map(x => <th key={x} className="px-3 py-2">{x}</th>)}</tr></thead>
            <tbody>{records.map(record => <tr className="border-t" key={record.id}>
              <td className="px-3 py-2">{new Date(record.createdAt).toLocaleString("zh-CN")}</td>
              <td className="px-3 py-2">{record.stage}</td><td className="px-3 py-2">{record.provider}</td>
              <td className="px-3 py-2">{record.verdict}</td>
              <td className="px-3 py-2">{record.category || record.reasonCode || "—"}</td>
              <td className="px-3 py-2">{["prompt", "output"].includes(record.stage) && <button className="underline" onClick={() => setReviewId(record.id)}>复核记录</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
      {reviewId && <form className="grid gap-2 rounded-lg border p-3" onSubmit={async event => {
        event.preventDefault();
        if (await send({ action: "review_record", recordId: reviewId, verdict: reviewVerdict, note: reviewNote })) {
          setReviewId(""); setReviewNote("");
        }
      }}>
        <p className="text-xs font-medium">人工复核 · {reviewId.slice(0, 8)}</p>
        <select className="rounded-md border bg-background p-2 text-xs" value={reviewVerdict} onChange={e => setReviewVerdict(e.target.value)}>
          <option value="escalated">升级处理</option><option value="confirmed_violation">确认违规</option><option value="false_positive">误拦截</option>
        </select>
        <textarea required minLength={8} maxLength={1500} placeholder="说明判断依据（至少8字，不粘贴用户原始内容）" className="rounded-md border bg-background p-2 text-xs" value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
        <div className="flex gap-2"><button disabled={busy} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground">保存复核记录</button><button type="button" className="rounded-md border px-3 py-2 text-xs" onClick={() => setReviewId("")}>取消</button></div>
      </form>}
      <button className="rounded-md border px-3 py-2 text-xs" disabled={busy} onClick={() => void refresh().catch(error => setError(String(error)))}>刷新审核记录</button>
    </>}
  </section>;
}
