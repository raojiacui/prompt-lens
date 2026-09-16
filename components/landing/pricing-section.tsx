"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Check } from "lucide-react";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";
import { AlipayCheckoutDialog } from "@/components/payments/alipay-checkout-dialog";
import { useSession } from "@/lib/auth/auth-client";

export function PricingSection({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const zh = useLocale() === "zh";
  const { data: session } = useSession();
  const authenticated = isAuthenticated || Boolean(session?.user);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<(typeof COMMERCIAL_PACKAGES)[number] | null>(null);
  const requestIds = useRef<Record<string, string>>({});
  const [checkoutAttempt, setCheckoutAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/payments/checkout", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setEnabled(data?.enabled === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const settings = authenticated ? "/dashboard?tab=settings" : "/login?next=%2Fdashboard%3Ftab%3Dsettings";
  return (
    <section id="pricing" className="bg-[#F7F1E8] py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-10 text-center">
          <h2 className="font-serif-display text-3xl text-[var(--color-text-primary)] md:text-4xl">{zh ? "按创作需要，灵活充值" : "Credits for your next creation"}</h2>
          <p className="mt-4 text-[var(--color-text-secondary)]">{zh ? "一次购买，按需使用。不自动续费。" : "One-time purchase. Pay as you create. No auto-renewal."}</p>
          {!enabled && <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{zh ? "套餐即将开放，当前暂不收款。" : "Plans are coming soon. Checkout is not open yet."}</p>}
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {COMMERCIAL_PACKAGES.map((pack, index) => (
            <article key={pack.id} className="flex flex-col rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-6">
              <h3 className="text-xl font-semibold">{zh ? pack.name : ["Starter", "Creator", "Volume"][index]}</h3>
              <p className="mt-5 text-3xl font-semibold">¥{(pack.priceCents / 100).toFixed(index === 0 ? 2 : 0)}</p>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{pack.credits.toLocaleString()} {zh ? "通用积分" : "credits"}</p>
              <ul className="my-6 space-y-3 text-sm text-[var(--color-text-secondary)]">
                {[
                  zh ? "自动拆镜与视频分析，按用量扣积分" : "Automatic shot splitting and video analysis, billed by usage",
                  zh ? "已核价视频生成模型，生成前确认费用" : "Priced video models, with a quote before generation",
                  zh ? `含 ${pack.rewrites} 次 AI 脚本改写，不另扣积分` : `${pack.rewrites} included AI rewrites, no extra credits`,
                  zh ? "自带 Key 也可用积分购买拆镜服务" : "Use credits for shot splitting alongside your own API key",
                ].map((line) => <li key={line} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4C7055]" /><span>{line}</span></li>)}
              </ul>
              <button type="button" disabled={!enabled} onClick={() => {
                if (!authenticated) { window.location.href = "/login?next=%2F%23pricing"; return; }
                const storageKey = `promptlens:checkout:${session?.user.id || "current"}:${pack.id}`;
                try { requestIds.current[pack.id] ??= localStorage.getItem(storageKey) || crypto.randomUUID(); localStorage.setItem(storageKey, requestIds.current[pack.id]); }
                catch { requestIds.current[pack.id] ??= crypto.randomUUID(); }
                setSelected(pack);
              }} className="mt-auto min-h-11 rounded-lg bg-[#241915] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50">
                {enabled ? (zh ? "支付宝购买" : "Buy with Alipay") : (zh ? "即将开放" : "Coming soon")}
              </button>
            </article>
          ))}
        </div>
        <div className="mt-8 grid gap-5 border-t border-[var(--color-border-subtle)] pt-6 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">{zh ? "已有 KIE API Key？" : "Already have a KIE API key?"}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{zh ? "手动上传分析和视频生成可使用自己的 Key，模型费用由你的 KIE 账户承担。自动拆镜单独消耗平台积分。" : "Use your own key for uploaded-file analysis and video generation. Model fees go to your KIE account; automatic splitting uses platform credits."}</p>
            <Link href={settings} className="mt-3 inline-block text-sm underline underline-offset-4">{zh ? "配置自己的 Key" : "Configure your key"}</Link>
          </div>
          <div>
            <h3 className="font-semibold">{zh ? "费用清楚，再开始" : "Know the cost before you start"}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{zh ? "拆镜每 6 秒 1 积分，不足 6 秒按 1 积分计；30 秒 5 积分，60 秒 10 积分。分析与生成另行报价，确认后才预留积分。" : "Shot splitting costs 1 credit per started 6 seconds: 5 credits for 30 seconds, 10 for 60. Analysis and generation are quoted separately; credits are reserved after confirmation."}</p>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-6 max-w-6xl px-4 text-center"><Link href="/billing" className="text-sm underline underline-offset-4">{zh ? "余额与订单" : "Balance and orders"}</Link></div>
      {selected && <AlipayCheckoutDialog key={`${selected.id}:${checkoutAttempt}`} pack={selected} requestId={requestIds.current[selected.id]} onClose={() => setSelected(null)} onNewOrder={() => {
        requestIds.current[selected.id] = crypto.randomUUID();
        try { localStorage.setItem(`promptlens:checkout:${session?.user.id || "current"}:${selected.id}`, requestIds.current[selected.id]); } catch { /* Keep the in-memory ID when storage is unavailable. */ }
        setCheckoutAttempt((value) => value + 1);
      }} onPaid={() => {
        delete requestIds.current[selected.id];
        try { localStorage.removeItem(`promptlens:checkout:${session?.user.id || "current"}:${selected.id}`); } catch { /* Storage may be unavailable in private browsing. */ }
      }} />}
    </section>
  );
}


