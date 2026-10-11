"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, RefreshCw } from "lucide-react";

type Review = { orders: { id: string; userId: string; amountCents: number; reconciliation: string | null }[]; refunds: { id: string; orderId: string; userId: string; email?: string | null; name?: string | null; packageName?: string; createdAt?: string; state: string; reason: string; contact: string | null; amountCents: number }[]; tasks: { id: string; userId: string; credits: number; rewrites: number }[]; taskReviews: { id: string; userId: string; kind: string; reason: string; action: string; deadlineAt: string | null; nextActionAt: string | null; nextFollowUpAt: string | null; lastNotifiedAt: string | null; lastNotificationError: string | null; assignedTo: string | null; acknowledgedAt: string | null; escalatedAt: string | null; reservedCredits: number; reservationId: string | null; canFullyRelease: boolean; updatedAt: string; providerTaskId: string | null; successfulScenes: number; finishedScenes: number; diagnostic: string | null }[]; taskReviewTotal: number; frozen: { userId: string }[] };
const reviewReasons: Record<string, [string, string]> = { save_failed: ["保存结果失败", "Result save failed"], settlement_failed: ["结算失败", "Settlement failed"], provider_unknown: ["供应商结果待确认", "Provider result unconfirmed"], checkpoint_invalid: ["任务检查点异常", "Task checkpoint invalid"], manual_required: ["需要人工核对", "Manual review required"], legacy_review: ["历史异常待核对", "Legacy task needs review"] };
export default function CommercialReviewPage() {
  const zh = useLocale() === "zh";
  const [data, setData] = useState<Review | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRefund, setSelectedRefund] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [customerContacted, setCustomerContacted] = useState(false);
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [taskEvidence, setTaskEvidence] = useState("");
  const [taskConfirmed, setTaskConfirmed] = useState(false);
  const refundHeading = useRef<HTMLHeadingElement>(null);
  const locatedRefunds = useRef(false);
  useEffect(() => {
    if (data && !locatedRefunds.current && window.location.hash === "#refunds") {
      refundHeading.current?.scrollIntoView({ block: "start" });
      locatedRefunds.current = true;
    }
  }, [data]);
  async function act(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/payments/commercial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(zh ? "处理未完成，请刷新并核对记录后重试。" : "Action not completed. Refresh and verify the records before retrying.");
      if (body.action === "query_refund" || body.action === "approve_refund") {
        const result = await response.json();
        setNotice(result.state === "succeeded"
          ? (zh ? "支付宝已确认退款成功，订单已更新。" : "Alipay confirmed the refund. The order has been updated.")
          : (zh ? "尚未确认退款成功，保留待核对状态，未再次发起退款。" : "Refund remains unconfirmed. No refund was resubmitted."));
      }
      if (body.action === "reject_refund") setNotice(zh ? "已拒绝申请，套餐额度已恢复。" : "Request declined. Package balance restored.");
      if (body.action === "release_unfulfilled_task") setNotice(zh ? "已记录核查证据并释放未交付任务的预留额度。" : "Evidence recorded and the undelivered task reservation was released.");
      if (body.action === "acknowledge_task_review") setNotice(zh ? "已认领异常任务，请完成供应商与交付核对。" : "Review claimed. Complete provider and delivery reconciliation.");
      window.dispatchEvent(new Event("refund-requests-changed"));
      setSelectedRefund(""); setReviewNote(""); setCustomerContacted(false); setApproveConfirmed(false); setSelectedTask(""); setTaskEvidence(""); setTaskConfirmed(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }
  async function load() {
    try {
      const response = await fetch(`/api/admin/payments/commercial?view=refunds&page=${page}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(response.status === 403 ? (zh ? "仅管理员可查看。" : "Administrator access required.") : (zh ? "暂时无法读取对账记录。" : "Unable to load reconciliation records."));
      const result = await response.json(); setData(result); setTotal(result.total); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }
  useEffect(() => { setData(null); void load(); }, [zh, page]);
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <header className="flex items-center justify-between border-b border-border pb-5"><Link href="/dashboard?tab=admin" className="flex items-center gap-2"><ArrowLeft size={18} />{zh ? "后台" : "Admin"}</Link><button onClick={() => void load()} title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新" : "Refresh"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><RefreshCw size={18} /></button></header>
    <h1 className="mt-8 text-2xl font-semibold">{zh ? "退款申请" : "Refund requests"}</h1>
    {error && <p role="alert" className="mt-5 text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-5 text-sm">{notice}</p>}
    {data && <>
      <section className="mt-8 space-y-3" aria-label={zh ? "异常任务" : "Tasks requiring reconciliation"}>
        <h2 className="text-lg font-semibold">{zh ? "异常任务待核对" : "Tasks requiring reconciliation"} ({data.taskReviewTotal || 0})</h2>
        {!data.taskReviews?.length && <p className="text-sm text-muted-foreground">{zh ? "暂无异常任务" : "No tasks requiring reconciliation"}</p>}
        {data.taskReviews?.map(task => <div key={task.id} className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">{task.kind === "analysis" ? (zh ? "视频分析" : "Video analysis") : (zh ? "视频生成" : "Video generation")} · {(reviewReasons[task.reason] || reviewReasons.manual_required)[zh ? 0 : 1]}</p>
          <p className="mt-1 break-all text-muted-foreground">{task.id} · {zh ? "预留积分" : "Reserved credits"} {task.reservedCredits}</p>
          <p className="mt-1 text-muted-foreground">{zh ? "下一步" : "Next action"}: {task.action === "automatic_recovery" ? (zh ? "系统自动恢复" : "Automatic recovery") : (zh ? "人工核对供应商记录" : "Manual provider reconciliation")}</p>
          {task.kind === "analysis" && <p className="mt-1 text-muted-foreground">{zh ? "已完成／成功镜头" : "Finished / successful shots"}: {task.finishedScenes} / {task.successfulScenes}</p>}
          {task.providerTaskId && <p className="mt-1 break-all text-muted-foreground">{zh ? "供应商任务" : "Provider task"}: {task.providerTaskId}</p>}
          {task.diagnostic && <p className="mt-1 break-words text-muted-foreground">{zh ? "最近错误" : "Last error"}: {task.diagnostic}</p>}
          {task.deadlineAt && <p className={`mt-1 ${task.escalatedAt ? "text-red-700" : "text-muted-foreground"}`}>{zh ? "处理期限" : "Review deadline"}: {new Date(task.deadlineAt).toLocaleString(zh ? "zh-CN" : "en-US")}{task.escalatedAt ? (zh ? " · 已升级人工处理" : " · Escalated") : ""}</p>}
          <p className="mt-1 text-muted-foreground">{zh ? "负责人" : "Owner"}: {task.assignedTo || (zh ? "未认领" : "Unclaimed")}{task.acknowledgedAt ? ` · ${new Date(task.acknowledgedAt).toLocaleString(zh ? "zh-CN" : "en-US")}` : ""}</p>
          {task.nextFollowUpAt && <p className="mt-1 text-muted-foreground">{zh ? "下次提醒" : "Next reminder"}: {new Date(task.nextFollowUpAt).toLocaleString(zh ? "zh-CN" : "en-US")}</p>}
          {task.lastNotificationError && <p className="mt-1 text-red-700">{zh ? "提醒发送失败" : "Alert failed"}: {task.lastNotificationError}</p>}
          <button disabled={busy} className="mt-2 min-h-10 underline" onClick={() => void act({ action: "acknowledge_task_review", taskId: task.id })}>{zh ? "认领并跟进" : "Claim review"}</button>
          {task.canFullyRelease && task.reservationId && <>
            <button disabled={busy} className="mt-2 min-h-10 underline" onClick={() => { setSelectedTask(task.id); setTaskEvidence(""); setTaskConfirmed(false); }}>{zh ? "核对并释放未交付额度" : "Review and release undelivered credits"}</button>
            {selectedTask === task.id && <div className="mt-3 space-y-3" role="group" aria-label={zh ? "任务预留额度核查" : "Task reservation review"}>
              <label className="block">{zh ? "核查证据（至少 12 个字）" : "Review evidence (at least 12 characters)"}<textarea minLength={12} maxLength={2000} value={taskEvidence} onChange={event => setTaskEvidence(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-border bg-background p-3" /></label>
              <label className="flex items-start gap-2"><input type="checkbox" checked={taskConfirmed} onChange={event => setTaskConfirmed(event.target.checked)} className="mt-1" />{zh ? "我已核对没有已交付的收费内容；此次操作会全额释放预留积分。" : "I verified that no billable result was delivered. This will release all reserved credits."}</label>
              <button disabled={busy || taskEvidence.trim().length < 12 || !taskConfirmed} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50" onClick={() => void act({ action: "release_unfulfilled_task", reservationId: task.reservationId, evidence: taskEvidence.trim(), deliveryConfirmed: true })}>{zh ? "确认释放预留" : "Confirm release"}</button>
            </div>}
          </>}
        </div>)}
        {data.taskReviewTotal > data.taskReviews.length && <p className="text-sm text-muted-foreground">{zh ? `当前显示最早的 ${data.taskReviews.length} 项，请先处理后刷新。` : `Showing the oldest ${data.taskReviews.length} tasks. Resolve them and refresh.`}</p>}
      </section>
      <h2 ref={refundHeading} id="refunds" className="mt-8 scroll-mt-6 text-lg font-semibold">{zh ? "待处理" : "Awaiting review"} ({total})</h2>
      {!data.refunds.length && <p className="mt-3 text-sm text-muted-foreground">{zh ? "暂无待处理的退款申请" : "No refund requests awaiting review"}</p>}
      {data.refunds.map((r) => <div key={r.id} className="space-y-3 border-b border-border py-4 text-sm">
        <p className="break-all font-medium">{r.name || r.email || r.userId}{r.name && r.email ? ` · ${r.email}` : ""}</p>
        <p>{r.packageName || "--"} · {({ requested: zh ? "待审核" : "Awaiting approval", processing: zh ? "退款处理中" : "Processing refund", review: zh ? "结果待核对" : "Outcome unconfirmed" }[r.state]) || r.state}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}` : ""}</p>
        <p className="break-all">{r.orderId} · ¥{(r.amountCents / 100).toFixed(2)}</p>
        <p className="break-words">{zh ? "申请原因：" : "Reason: "}{r.reason}</p>
        <p className="break-all">{zh ? "联系方式：" : "Contact: "}{r.contact || (zh ? "未提供，请核对用户资料" : "Not provided; check customer records")}</p>
        {r.state === "requested" ? <>
          <button disabled={busy} onClick={() => { setSelectedRefund(r.id); setReviewNote(""); setCustomerContacted(false); setApproveConfirmed(false); }} className="min-h-10 underline">{zh ? "审核申请" : "Review request"}</button>
          {selectedRefund === r.id && <div className="space-y-3" role="group" aria-label={zh ? "退款审核" : "Refund approval"}>
            <label className="flex items-start gap-2"><input type="checkbox" checked={customerContacted} onChange={(event) => setCustomerContacted(event.target.checked)} className="mt-1" />{zh ? "已与用户沟通并核对订单" : "I have contacted the customer and verified the order"}</label>
            <label className="block">{zh ? "处理备注（必填）" : "Review note (required)"}<textarea required minLength={1} maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-border bg-background p-3" /></label>
            <label className="flex items-start gap-2"><input type="checkbox" checked={approveConfirmed} onChange={(event) => setApproveConfirmed(event.target.checked)} className="mt-1" />{zh ? `我同意退还此订单全额 ¥${(r.amountCents / 100).toFixed(2)}；点击同意将向支付宝发起真实退款` : `I approve a full refund of ¥${(r.amountCents / 100).toFixed(2)}; approving will send a real Alipay refund`}</label>
            {(!reviewNote.trim() || !customerContacted) && <p className="text-muted-foreground">{zh ? "请填写处理备注，并确认已与用户沟通。" : "Enter a review note and confirm customer contact."}</p>}
            <div className="flex flex-wrap gap-3">
              <button disabled={busy || !customerContacted || !approveConfirmed || !reviewNote.trim()} onClick={() => void act({ action: "approve_refund", refundId: r.id, evidence: reviewNote, customerContacted, approveConfirmed })} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">{busy ? (zh ? "处理中…" : "Processing…") : (zh ? "同意并执行退款" : "Approve and refund")}</button>
              <button disabled={busy || !customerContacted || !reviewNote.trim()} onClick={() => void act({ action: "reject_refund", refundId: r.id, evidence: reviewNote, customerContacted })} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">{zh ? "拒绝申请并恢复额度" : "Decline and restore allowance"}</button>
            </div>
          </div>}
        </> : <>
          <p className="text-red-700">{zh ? "退款处理中或结果待核对。请先核对支付宝商户记录，不要重复发起退款。" : "Refund processing or outcome uncertain. Verify Alipay merchant records; do not submit another refund."}</p>
          <button disabled={busy} onClick={() => void act({ action: "query_refund", refundId: r.id })} className="flex min-h-10 items-center gap-2 underline disabled:opacity-50"><RefreshCw size={16} />{zh ? "查询退款状态" : "Query refund status"}</button>
        </>}
      </div>)}
      <div className="mt-5 flex justify-end gap-4"><button disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>{zh ? "上一页" : "Previous"}</button><span>{page} / {Math.max(1, Math.ceil(total / 20))}</span><button disabled={busy || page * 20 >= total} onClick={() => setPage(p => p + 1)}>{zh ? "下一页" : "Next"}</button></div>
    </>}
  </main>;
}
