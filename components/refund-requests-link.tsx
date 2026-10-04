"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useLocale } from "next-intl";

export function RefundRequestsLink() {
  const zh = useLocale() === "zh";
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/admin/payments/commercial?countOnly=1", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) setCount(data.total);
      } catch { if (active) setCount(null); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("refund-requests-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("refund-requests-changed", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return <Link href="/billing/review#refunds" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm"><Bell className="h-4 w-4" />{zh ? "退款申请" : "Refund requests"}<span aria-live="polite" className="grid min-h-5 min-w-5 place-items-center rounded-full bg-red-700 px-1 text-xs text-white">{count ?? "—"}</span></Link>;
}
