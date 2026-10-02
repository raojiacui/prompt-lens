"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { CheckCircle2, RefreshCw, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { shouldRestartCheckout } from "@/lib/payments/checkout-restart";

type Checkout = { orderId: string; amountCents: number; credits: number; rewrites: number; qrImageUrl: string | null; mobilePaymentUrl: string | null; paymentUrl?: string | null; cancellationRequested?: boolean; expiresAt: string; status: string };
function safePaymentUrl(value: string | null | undefined) {
  if (value?.startsWith("/api/payments/orders/")) return value;
  try { const url = new URL(value || ""); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

export function AlipayCheckoutDialog({ pack, requestId, existingOrderId, onClose, onPaid, onNewOrder, previousOrderUnconfirmed = false }: {
  pack: { id: string; priceCents: number; credits: number; rewrites: number };
  requestId: string; existingOrderId?: string; onClose: () => void; onPaid: () => void;
  onNewOrder?: (previous?: { orderId: string; status: string }) => void;
  previousOrderUnconfirmed?: boolean;
}) {
  const zh = useLocale() === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const paidNotified = useRef(false);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [unpaidConfirmed, setUnpaidConfirmed] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  useEffect(() => {
    dialog.current?.showModal();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (checkout) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    // Defer until effect setup completes so Strict Mode does not start two checkouts.
    const timer = setTimeout(() => {
    fetch(existingOrderId ? `/api/payments/orders/${existingOrderId}?snapshot=1` : "/api/payments/checkout", existingOrderId ? { cache: "no-store", signal: controller.signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: pack.id, provider: "alipay", method: "alipay", requestId }), signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.code === "CHECKOUT_NOT_OPEN" ? (zh ? "收款暂未开放" : "Checkout is not open yet") : (zh ? "暂时无法确认订单，请重试查询。" : "Unable to confirm the order. Retry to check."));
        if (!data.orderId || !Number.isFinite(Date.parse(data.expiresAt)) || !Number.isSafeInteger(data.amountCents) || data.amountCents < 1
          || !Number.isSafeInteger(data.credits) || data.credits < 0 || !Number.isSafeInteger(data.rewrites) || data.rewrites < 0) throw new Error(zh ? "订单信息不完整" : "Incomplete order information");
        // A purchase click may restore an expired idempotency key. Start a fresh
        // checkout, but never replace an order opened explicitly from history.
        if (!controller.signal.aborted && !existingOrderId && onNewOrder && shouldRestartCheckout(data)) {
          onNewOrder({ orderId: data.orderId, status: data.status });
          return;
        }
        if (!controller.signal.aborted) { setLoading(false); setCheckout(data); }
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pack.id, requestId, existingOrderId, attempt, zh, checkout?.orderId]);
  useEffect(() => {
    if (!checkout || checkout.status !== "pending") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const stopAt = Math.max(Date.now() + 120000, Date.parse(checkout.expiresAt) + 120000);
    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/orders/${checkout.orderId}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("status unavailable");
        const data = await response.json();
        if (!["pending", "paid", "failed", "refunded", "cancelled"].includes(data.status)) throw new Error("invalid status");
        if (!controller.signal.aborted) {
          setError("");
          setCheckout((current) => current ? (current.status !== "pending" && data.status === "pending" ? current : { ...current, status: data.status,
            cancellationRequested: data.cancellationRequested, qrImageUrl: data.qrImageUrl ?? null, mobilePaymentUrl: data.mobilePaymentUrl ?? null, paymentUrl: data.paymentUrl ?? null }) : null);
        }
        if (data.status !== "pending") return;
      } catch {
        if (!controller.signal.aborted) setError(zh ? "暂时无法查询到账状态，请勿重复付款。" : "Payment status is unavailable. Do not pay again.");
      }
      if (!controller.signal.aborted && Date.now() < stopAt) timer = setTimeout(poll, 5000);
      else if (!controller.signal.aborted) setError(zh ? "到账仍待确认，请保留订单号并稍后查询。" : "Payment is still unconfirmed. Keep your order ID and check later.");
    };
    timer = setTimeout(poll, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [checkout?.orderId, checkout?.status, attempt, zh]);
  useEffect(() => {
    if (checkout?.status === "paid" && !paidNotified.current) { paidNotified.current = true; onPaidRef.current(); }
  }, [checkout?.status]);

  const remaining = checkout ? Math.max(0, Math.ceil((Date.parse(checkout.expiresAt) - now) / 1000)) : 0;
  const paid = checkout?.status === "paid";
  const pending = checkout?.status === "pending";
  const qr = checkout && safePaymentUrl(checkout.qrImageUrl);
  const paymentUrl = checkout && safePaymentUrl(checkout.paymentUrl || checkout.mobilePaymentUrl);
  const embeddedUrl = paymentUrl && /^\/api\/payments\/orders\/[0-9a-f-]{36}\/pay$/i.test(paymentUrl) ? `${paymentUrl}?embedded=1` : null;
  async function cancelPayment() {
    if (!checkout || cancelling) return;
    setCancelling(true); setError("");
    setCheckout((current) => current ? { ...current, cancellationRequested: true, paymentUrl: null, mobilePaymentUrl: null } : null);
    try {
      const response = await fetch(`/api/payments/orders/${checkout.orderId}/close`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !["cancelled", "paid", "refunded"].includes(data.status)) throw new Error(zh ? "取消结果待核对，请重新查询，暂勿付款或另建订单。" : "Cancellation is unconfirmed. Check again; do not pay or create another order yet.");
      setCheckout((current) => current ? { ...current, status: data.status } : null);
      setCancelConfirm(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Error"); }
    finally { setCancelling(false); }
  }
  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="alipay-checkout-title" className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-xl backdrop:bg-black/50 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <h3 id="alipay-checkout-title" className="text-xl font-semibold">{zh ? "支付宝支付" : "Alipay checkout"}</h3>
        <button onClick={onClose} aria-label={zh ? "关闭" : "Close"} title={zh ? "关闭" : "Close"} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-4 min-h-9 text-center text-3xl font-semibold">{checkout ? `¥${(checkout.amountCents / 100).toFixed(2)}` : "--"}</p>
      <p className="mt-2 min-h-5 text-center text-sm text-muted-foreground">{checkout && <>{checkout.credits} {zh ? "积分" : "credits"} · {checkout.rewrites} {zh ? "次改写" : "rewrites"}</>}</p>
      {previousOrderUnconfirmed && <p role="status" className="mt-3 text-sm text-amber-800">{zh ? "上一笔订单已超时，已重新下单。若上一笔已经付款，请勿重复支付，可在「余额与订单」核对到账。" : "Your previous order expired and a new checkout was created. If you already paid, do not pay again; check Balance and orders."}</p>}
      <div className={`my-4 flex flex-col items-center justify-center gap-2 text-center ${loading ? "min-h-56" : ""}`} aria-live="polite">
        {loading && <><Spinner /><p className="text-sm text-muted-foreground">{zh ? "正在加载订单…" : "Loading your order…"}</p></>}
        {paid && <><CheckCircle2 className="h-12 w-12 text-green-700" /><p>{zh ? "支付成功，权益已到账" : "Payment received. Credits and rewrites added."}</p></>}
        {pending && remaining > 0 && !checkout.cancellationRequested && (embeddedUrl ? <>
          {/* Alipay anchors the 224px code at the frame origin; retain a 16px quiet zone on every side. */}
          <div className="relative h-64 w-64 shrink-0 overflow-hidden rounded-lg bg-white">
            <iframe key={checkout.orderId} src={embeddedUrl} title={zh ? "支付宝付款二维码" : "Alipay payment QR code"} width={256} height={256} className="absolute left-4 top-4 h-64 w-64 border-0 bg-white" sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="same-origin" />
          </div>
          <p className="text-sm">{zh ? "打开支付宝，扫一扫付款" : "Scan with Alipay to pay"}</p>
          <a href={paymentUrl!} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline underline-offset-4">{zh ? "手机付款 / 二维码无法显示" : "Pay on mobile / QR unavailable"}</a>
        </> : qr ? <img src={qr} alt={zh ? "支付宝付款二维码" : "Alipay payment QR code"} width={224} height={224} className="h-56 w-56 max-w-full object-contain" onError={() => setError(zh ? "二维码加载失败，请稍后查询订单。" : "QR code could not load. Check the order later.")} /> : paymentUrl ? <a href={paymentUrl} className="rounded-lg bg-[#1677ff] px-5 py-3 text-white">{zh ? "前往支付宝支付" : "Continue to Alipay"}</a> : <p>{zh ? "正在准备支付宝收银台，请勿另建订单。" : "Preparing Alipay checkout. Do not create another order."}</p>)}
        {pending && checkout.cancellationRequested && <p>{zh ? "正在核对取消结果，请勿继续付款。" : "Verifying cancellation. Do not continue payment."}</p>}
        {pending && <p className="text-sm text-muted-foreground">{remaining ? (zh ? `付款码有效时间 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : `Payment code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`) : (zh ? "付款码已过期；如已付款，请等待到账确认。" : "Payment code expired. If paid, wait for confirmation.")}</p>}
        {checkout && !pending && !paid && <p>{zh ? ({ failed: "订单未完成", refunded: "订单已退款", cancelled: "订单已取消" }[checkout.status] || "订单状态待确认") : `Order ${checkout.status}`}</p>}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      {pending && <div className="mb-3 space-y-3 text-sm">
        <p className="text-muted-foreground">{zh ? "下单后 15 分钟内未完成付款，订单将自动取消。已付款的订单会核对到账，不会按未付款取消。" : "Unpaid orders expire 15 minutes after creation. Completed payments are reconciled, not cancelled as unpaid."}</p>
        {!cancelConfirm ? <button disabled={cancelling} onClick={() => setCancelConfirm(true)} className="min-h-10 w-full rounded-lg border border-border px-3">{zh ? "取消本次付款" : "Cancel this payment"}</button> : <>
          <p>{zh ? "确认不再支付这笔订单？若已付款，将先核对到账，此操作不是退款。" : "Stop paying this order? Any completed payment will be reconciled. This is not a refund."}</p>
          <div className="flex gap-3"><button disabled={cancelling} onClick={() => void cancelPayment()} className="min-h-10 flex-1 rounded-lg border border-border px-3 disabled:opacity-50">{zh ? "确认取消" : "Confirm cancellation"}</button><button disabled={cancelling} onClick={() => setCancelConfirm(false)} className="min-h-10 px-3">{zh ? "返回" : "Back"}</button></div>
        </>}
      </div>}
      {!paid && !loading && <button onClick={() => setAttempt((value) => value + 1)} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm"><RefreshCw className="h-4 w-4" />{zh ? "重新查询" : "Check again"}</button>}
      {onNewOrder && checkout && !paid && (pending ? remaining === 0 : ["failed", "cancelled", "refunded"].includes(checkout.status)) && <div className="mt-4 border-t border-border pt-4 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={unpaidConfirmed} onChange={(event) => setUnpaidConfirmed(event.target.checked)} /><span>{zh ? "我已核对支付宝账单，确认此订单未付款或已退款。新订单不会取消旧订单，请勿重复付款。" : "I checked Alipay and this order is unpaid or refunded. A new order does not cancel the old one. Do not pay twice."}</span></label>
        <button disabled={!unpaidConfirmed} onClick={() => onNewOrder({ orderId: checkout.orderId, status: checkout.status })} className="mt-3 min-h-11 w-full rounded-lg border border-border px-3 disabled:opacity-50">{zh ? "创建新订单" : "Create a new order"}</button>
      </div>}
      {checkout && <p className="mt-4 break-all text-xs text-muted-foreground">{zh ? "订单号：" : "Order: "}{checkout.orderId}</p>}
    </dialog>
  );
}
