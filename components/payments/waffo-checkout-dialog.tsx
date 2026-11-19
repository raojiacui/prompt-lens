"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { X } from "lucide-react";
import { refreshWalletBalance } from "@/lib/billing/use-wallet-balance";

type Checkout = { orderId: string; status: string; checkoutUrl: string | null };
function paymentUrl(value: unknown) {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    return url.protocol === "https:" && url.hostname === "pancake.waffo.ai" && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
export function WaffoCheckoutDialog({ pack, requestId, existingOrderId, onClose, onPaid }: {
  pack: { id: string; name?: string; priceCents: number }; requestId?: string; existingOrderId?: string;
  onClose: () => void; onPaid: () => void;
}) {
  const zh = useLocale() === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const originalRequestId = useRef(requestId).current;
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const notified = useRef(false);
  const paidCallback = useRef(onPaid); paidCallback.current = onPaid;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/payments/waffo/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existingOrderId ? { orderId: existingOrderId } : { packageId: pack.id, requestId: originalRequestId }), signal: controller.signal });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!/^[0-9a-f-]{36}$/i.test(data.orderId)) throw Error();
        if (!stopped) setCheckout({ orderId: data.orderId, status: data.status, checkoutUrl: paymentUrl(data.checkoutUrl) });
      } catch { if (!stopped) setError(zh ? "暂时无法打开结账，请重试同一订单；已付款时请勿重复付款。" : "Unable to open checkout. Retry this order; do not pay again if already charged."); }
      finally { if (!stopped) setLoading(false); }
    }, 0);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [pack.id, originalRequestId, existingOrderId, attempt, zh]);
  const orderId = checkout?.orderId;
  useEffect(() => {
    if (!orderId) return;
    let stopped = false, polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/orders/${orderId}`, { cache: "no-store" });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!stopped) {
          setCheckout(current => current ? { ...current, status: data.status } : current);
          if (data.status === "paid" && !notified.current) { notified.current = true; refreshWalletBalance(); paidCallback.current(); }
          if (data.paymentIssue) setError(zh ? "支付结果正在核查，请稍后查询订单或联系支持。" : "Payment is under review. Check your order later or contact support.");
          if (data.status === "pending" && ++polls < 100) timer = setTimeout(poll, 3000);
        }
      } catch { if (!stopped && ++polls < 100) timer = setTimeout(poll, 5000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [orderId, attempt, zh]);
  const pending = checkout?.status === "pending";
  return <dialog ref={dialog} aria-label={zh ? "购买套餐" : "Buy package"} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/50">
    <header className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{pack.name}</h2><button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><X size={18} /></button></header>
    <p className="mt-5 text-2xl font-semibold">¥{(pack.priceCents / 100).toFixed(2)}</p>
    <p className="mt-2 text-sm text-muted-foreground">{zh ? "一次性购买，不自动续费。最终税费及支付方式以 Waffo 结账页为准。" : "One-time purchase, no renewal. Final tax and available payment methods are shown at Waffo checkout."}</p>
    {loading && <p role="status" className="mt-5">{zh ? "正在准备结账…" : "Preparing checkout…"}</p>}
    {checkout?.status === "paid" && <p role="status" className="mt-5 text-green-700">{zh ? "支付成功，套餐权益已到账。" : "Payment confirmed. Your package is available."}</p>}
    {checkout && !pending && checkout.status !== "paid" && <p role="status" className="mt-5">{zh ? "请在订单页查看订单和退款状态。" : "View your order and refund status on the billing page."}</p>}
    {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
    {pending && checkout.checkoutUrl && !loading && <a href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-foreground px-5 text-background">{zh ? "前往 Waffo 安全结账" : "Continue to Waffo checkout"}</a>}
    {(!checkout || pending) && <button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)} className="mt-4 block min-h-10 rounded-lg border border-border px-4 text-sm disabled:opacity-50">{zh ? "刷新结账与支付状态" : "Refresh checkout and payment status"}</button>}
    <p className="mt-4 text-sm text-muted-foreground">{zh ? "关闭此窗口不会取消付款。若已付款，请等待确认，避免重复支付。" : "Closing this window does not cancel payment. If already charged, wait for confirmation before paying again."}</p>
    <Link href="/billing" className="mt-5 inline-block text-sm underline">{zh ? "查看余额与订单" : "View balance and orders"}</Link>
  </dialog>;
}
