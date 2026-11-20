"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { X } from "lucide-react";
import { refreshWalletBalance } from "@/lib/billing/use-wallet-balance";
import { formatPaymentAmount, paymentCurrency, paymentDecimal, type PaymentCurrency } from "@/lib/payments/currencies";

type Checkout = { orderId: string; status: string; checkoutUrl: string | null; currency: PaymentCurrency; amountMinor: number; linkExpiresAt: string | null; orderExpiresAt: string | null; unavailableReason?: string };
function paymentUrl(value: unknown) {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    return url.protocol === "https:" && url.hostname === "pancake.waffo.ai" && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
export function WaffoCheckoutDialog({ pack, requestId, existingOrderId, currency = "CNY", onClose, onPaid }: {
  pack: { id: string; name?: string; priceCents: number }; requestId?: string; existingOrderId?: string;
  currency?: PaymentCurrency; onClose: () => void; onPaid: () => void;
}) {
  const zh = useLocale() === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const originalRequestId = useRef(requestId).current;
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const checkoutRequestId = useRef<string | null>(null);
  const [now, setNow] = useState(0);
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
        checkoutRequestId.current ??= crypto.randomUUID();
        const response = await fetch("/api/payments/waffo/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existingOrderId ? { orderId: existingOrderId, checkoutRequestId: checkoutRequestId.current } : { packageId: pack.id, requestId: originalRequestId, currency, checkoutRequestId: checkoutRequestId.current }), signal: controller.signal });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!/^[0-9a-f-]{36}$/i.test(data.orderId)) throw Error();
        const actualCurrency = paymentCurrency(data.currency);
        paymentDecimal(data.amountMinor, actualCurrency);
        if (!existingOrderId && actualCurrency !== currency) throw Error();
        if (!stopped) {
          const result = { orderId: data.orderId, status: data.status, checkoutUrl: paymentUrl(data.checkoutUrl), amountMinor: data.amountMinor, currency: actualCurrency,
            linkExpiresAt: typeof data.linkExpiresAt === "string" && Number.isFinite(Date.parse(data.linkExpiresAt)) ? data.linkExpiresAt : null,
            orderExpiresAt: typeof data.orderExpiresAt === "string" && Number.isFinite(Date.parse(data.orderExpiresAt)) ? data.orderExpiresAt : null,
            unavailableReason: data.unavailableReason };
          setNow(Date.now());
          setCheckout(result);
        }
      } catch { if (!stopped) setError(zh ? "暂时无法打开付款页面。如已扣款，请勿重复下单。" : "Unable to open checkout. Do not place another order if already charged."); }
      finally { if (!stopped) setLoading(false); }
    }, 0);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [pack.id, originalRequestId, existingOrderId, currency, zh]);
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
          if (data.paymentIssue) setError(zh ? "付款状态暂未确认。如已扣款，请勿重复下单。" : "Payment is unconfirmed. Do not place another order if already charged.");
          if (data.status === "pending" && ++polls < 100) timer = setTimeout(poll, 3000);
        }
      } catch { if (!stopped && ++polls < 100) timer = setTimeout(poll, 5000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [orderId, zh]);
  const pending = checkout?.status === "pending";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const orderExpired = checkout?.unavailableReason === "expired" || Boolean(checkout?.orderExpiresAt && Date.parse(checkout.orderExpiresAt) <= now);
  const linkExpired = Boolean(checkout?.linkExpiresAt && Date.parse(checkout.linkExpiresAt) <= now);
  const unavailable = orderExpired || checkout?.unavailableReason === "cancelled";
  const deadline = (value: string) => new Date(value).toLocaleString(zh ? "zh-CN" : "en-US", { hour12: false });
  return <dialog ref={dialog} aria-label={zh ? "购买套餐" : "Buy package"} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/50">
    <header className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{pack.name}</h2><button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><X size={18} /></button></header>
    {checkout && <p className="mt-5 text-2xl font-semibold">{formatPaymentAmount(checkout.amountMinor, checkout.currency, zh ? "zh-CN" : "en-US")}</p>}
    {loading && <p role="status" className="mt-5">{zh ? "正在准备结账…" : "Preparing checkout…"}</p>}
    {checkout?.status === "paid" && <p role="status" className="mt-5 text-green-700">{zh ? "支付成功，套餐权益已到账。" : "Payment confirmed. Your package is available."}</p>}
    {checkout && !pending && checkout.status !== "paid" && <p role="status" className="mt-5">{zh ? "请在订单页查看订单和退款状态。" : "View your order and refund status on the billing page."}</p>}
    {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
    {pending && checkout.linkExpiresAt && !unavailable && !linkExpired && !error && <p className="mt-3 text-sm text-muted-foreground">{zh ? `付款链接有效至 ${deadline(checkout.linkExpiresAt)}` : `Payment link expires at ${deadline(checkout.linkExpiresAt)}`}</p>}
    {pending && (unavailable || linkExpired) && !error && <p role="status" className="mt-4 text-sm">{zh ? "付款链接已失效。如已扣款，请勿重复下单。" : "This payment link is unavailable. Do not place another order if already charged."}</p>}
    {!loading && (pending || error) && <div className="mt-6 flex flex-wrap items-center gap-3">
      {pending && checkout.checkoutUrl && !error && !linkExpired && !unavailable && <a href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg bg-foreground px-5 text-background">{zh ? "前往 Waffo 安全结账" : "Continue to Waffo checkout"}</a>}
      <a href="/pricing?newCheckout=1#pricing" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm">{zh ? "返回套餐页重新下单" : "Return to packages to place a new order"}</a>
    </div>}
  </dialog>;
}
