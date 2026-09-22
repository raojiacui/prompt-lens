"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";

export function PaymentReturnClient() {
  const zh = useLocale() === "zh";
  const orderId = useSearchParams().get("orderId") || "";
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) { setError(zh ? "订单信息无效" : "Invalid order"); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/orders/${orderId}`, { cache: "no-store" });
        if (response.status === 401) { window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!stopped) { setStatus(data.status); setError(""); }
        if (!stopped && data.status === "pending") timer = setTimeout(poll, 3000);
      } catch {
        if (!stopped) setError(zh ? "暂时无法确认支付结果，请稍后在订单页查询。" : "Unable to confirm payment yet. Check your orders shortly.");
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [orderId, zh]);

  const paid = status === "paid";
  const failed = ["failed", "cancelled", "refunded"].includes(status);
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center text-foreground">
    {paid ? <CheckCircle2 className="h-14 w-14 text-green-700" /> : failed ? <XCircle className="h-14 w-14 text-red-700" /> : <Clock3 className="h-14 w-14 text-amber-700" />}
    <h1 className="mt-5 text-2xl font-semibold">{paid ? (zh ? "支付成功" : "Payment confirmed") : failed ? (zh ? "订单未完成" : "Payment not completed") : (zh ? "正在确认支付结果" : "Confirming payment")}</h1>
    <p className="mt-3 text-sm text-muted-foreground">{paid ? (zh ? "积分与改写次数已经到账。" : "Your credits and rewrites are now available.") : (zh ? "页面回跳不代表支付成功，系统正在向支付宝查询最终状态。" : "Returning to this page does not prove payment. We are checking the final status with Alipay.")}</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <Link href="/billing" className="mt-7 rounded-lg border border-border px-5 py-3 text-sm">{zh ? "查看余额与订单" : "View balance and orders"}</Link>
  </main>;
}
