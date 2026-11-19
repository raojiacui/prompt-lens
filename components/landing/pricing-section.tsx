"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Check } from "lucide-react";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";
import { AlipayCheckoutDialog } from "@/components/payments/alipay-checkout-dialog";
import { WaffoCheckoutDialog } from "@/components/payments/waffo-checkout-dialog";
import { useSession } from "@/lib/auth/auth-client";
import { PAYMENT_CURRENCIES, paymentCurrency, formatPaymentAmount, type PaymentCurrency } from "@/lib/payments/currencies";
import type { WaffoPrice } from "@/lib/payments/waffo-pricing";

export function PricingSection({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const zh = useLocale() === "zh";
  const { data: session } = useSession();
  const authenticated = isAuthenticated || Boolean(session?.user);
  const [selected, setSelected] = useState<(typeof COMMERCIAL_PACKAGES)[number] | null>(null);
  const requestIds = useRef<Record<string, string>>({});
  const [checkoutAttempt, setCheckoutAttempt] = useState(0);
  const [previousOrderUnconfirmed, setPreviousOrderUnconfirmed] = useState(false);
  const [waffoPackages, setWaffoPackages] = useState<string[]>([]);
  const [currency, setCurrency] = useState<PaymentCurrency>("CNY");
  const [selectedCurrency, setSelectedCurrency] = useState<PaymentCurrency>("CNY");
  const [quotes, setQuotes] = useState<WaffoPrice[]>([]);
  const [quoteError, setQuoteError] = useState(false);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/payments/waffo/checkout", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (data.enabled && Array.isArray(data.packages)) setWaffoPackages(data.packages.filter((id: unknown): id is string => typeof id === "string"));
      try { setCurrency(paymentCurrency(localStorage.getItem("promptlens:payment-currency") || data.suggestedCurrency || "CNY")); }
      catch { setCurrency(paymentCurrency(data.suggestedCurrency || "CNY")); }
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!waffoPackages.length) return;
    const controller = new AbortController();
    setQuotes([]); setQuoteError(false);
    void fetch(`/api/payments/waffo/checkout?currency=${currency}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!Array.isArray(data.quotes)) throw Error();
      if (!controller.signal.aborted) setQuotes(data.quotes.filter((quote: WaffoPrice) => quote.currency === currency && Number.isSafeInteger(quote.amountMinor) && quote.amountMinor > 0));
    }).catch(() => { if (!controller.signal.aborted) setQuoteError(true); });
    return () => controller.abort();
  }, [currency, waffoPackages, quoteAttempt]);
  const settings = authenticated ? "/dashboard?tab=settings" : "/login?next=%2Fdashboard%3Ftab%3Dsettings";
  return (
    <section id="pricing" className="bg-[#F7F1E8] py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-10 text-center">
          <h2 className="font-serif-display text-3xl text-[var(--color-text-primary)] md:text-4xl">{zh ? "按创作需要，灵活充值" : "Credits for your next creation"}</h2>
          <p className="mt-4 text-[var(--color-text-secondary)]">{zh ? "一次购买，按需使用。不自动续费。" : "One-time purchase. Pay as you create. No auto-renewal."}</p>
        </div>
        {!!waffoPackages.length && <div className="mb-6 space-y-2 text-sm">
          <label className="flex items-center justify-center gap-3">{zh ? "付款币种" : "Payment currency"}<select aria-label={zh ? "付款币种" : "Payment currency"} value={currency} onChange={event => {
            const value = paymentCurrency(event.target.value); setCurrency(value);
            try { localStorage.setItem("promptlens:payment-currency", value); } catch { /* Preserve the current selection in memory. */ }
          }} className="min-h-11 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3">
            {PAYMENT_CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}
          </select></label>
          <p className="text-center text-[var(--color-text-secondary)]">{zh ? "海外银行卡请选择外币；外币价格按人民币基价换算，下单时锁定，税费在结账页展示。" : "Choose a foreign currency for card payments. Converted prices are locked when ordering; tax is shown at checkout."}</p>
          {quoteError && <p role="alert" className="text-center text-red-700">{zh ? "暂时无法取得换算价格，请稍后重试。" : "Converted prices are unavailable. Please retry shortly."}<button type="button" onClick={() => setQuoteAttempt(value => value + 1)} className="ml-2 min-h-10 underline">{zh ? "重新获取价格" : "Refresh prices"}</button></p>}
        </div>}
        <div className="grid gap-5 md:grid-cols-3">
          {COMMERCIAL_PACKAGES.map((pack, index) => {
            const quote = quotes.find(price => price.packageId === pack.id && price.currency === currency);
            return (
            <article key={pack.id} className="flex flex-col rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-6">
              <h3 className="text-xl font-semibold">{zh ? pack.name : ["Starter", "Creator", "Volume"][index]}</h3>
              <p className="mt-5 text-3xl font-semibold">{waffoPackages.includes(pack.id) ? quote ? formatPaymentAmount(quote.amountMinor, currency, zh ? "zh-CN" : "en-US") : (zh ? "价格确认中…" : "Checking price…") : `¥${(pack.priceCents / 100).toFixed(pack.priceCents % 100 === 0 ? 0 : 2)}`}</p>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{pack.credits.toLocaleString()} {zh ? "通用积分" : "credits"}</p>
              <ul className="my-6 space-y-3 text-sm text-[var(--color-text-secondary)]">
                {[
                  zh ? "自动拆镜与视频分析，按用量扣积分" : "Automatic shot splitting and video analysis, billed by usage",
                  zh ? `含 ${pack.linkImports} 次抖音、TikTok、B站视频链接导入，失败不计次` : `${pack.linkImports} included Douyin, TikTok and Bilibili video link imports; failures do not count`,
                  zh ? "已核价视频生成模型，生成前确认费用" : "Priced video models, with a quote before generation",
                  zh ? `含 ${pack.rewrites} 次 AI 脚本改写，不另扣积分` : `${pack.rewrites} included AI rewrites, no extra credits`,
                  zh ? "自带 Key 也可购买套餐，套餐积分可用于自动拆镜服务" : "You can buy a package with your own API key and use its credits for automatic shot splitting",
                ].map((line) => <li key={line} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4C7055]" /><span>{line}</span></li>)}
              </ul>
              <button type="button" disabled={waffoPackages.includes(pack.id) ? !quotes.some(quote => quote.packageId === pack.id && quote.currency === currency) : !pack.checkoutEnabled} onClick={() => {
                if (!pack.checkoutEnabled && !waffoPackages.includes(pack.id)) return;
                if (!authenticated) { window.location.href = "/login?next=%2F%23pricing"; return; }
                const waffo = waffoPackages.includes(pack.id);
                const attemptKey = waffo ? `${pack.id}:${currency}` : pack.id;
                const storageKey = `promptlens:${waffo ? "waffo-checkout" : "checkout"}:${session?.user.id || "current"}:${pack.id}${waffo ? `:${currency}` : ""}`;
                try { requestIds.current[attemptKey] ??= localStorage.getItem(storageKey) || crypto.randomUUID(); localStorage.setItem(storageKey, requestIds.current[attemptKey]); }
                catch { requestIds.current[attemptKey] ??= crypto.randomUUID(); }
                setSelectedCurrency(currency);
                setPreviousOrderUnconfirmed(false);
                setSelected(pack);
              }} className="mt-auto min-h-11 rounded-lg bg-[#241915] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50">
                {!pack.checkoutEnabled && !waffoPackages.includes(pack.id) ? (zh ? "待开放" : "Coming soon") : authenticated ? waffoPackages.includes(pack.id) ? (zh ? "购买套餐" : "Buy package") : (zh ? "支付宝购买" : "Buy with Alipay") : (zh ? "登录后购买" : "Sign in to buy")}
              </button>
            </article>
          ); })}
        </div>
        <div className="mt-8 grid gap-5 border-t border-[var(--color-border-subtle)] pt-6 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">{zh ? "已有自己的 API Key？" : "Already have your own API key?"}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{zh ? "手动上传分析和视频生成可使用自己的 Key，模型费用由对应供应商账户承担。自动拆镜单独消耗平台积分。" : "Use your own key for uploaded-file analysis and video generation. Model fees go to the corresponding provider account; automatic splitting uses platform credits."}</p>
            <Link href={settings} className="mt-3 inline-block text-sm underline underline-offset-4">{zh ? "配置自己的 Key" : "Configure your key"}</Link>
          </div>
          <div>
            <h3 className="font-semibold">{zh ? "费用清楚，再开始" : "Know the cost before you start"}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{zh ? "视频链接解析并保存成功才计一次，不额外扣积分；失败不计次，重复请求不重复计数。处理中暂占一次，失败后释放。拆镜每 6 秒 1 积分；30 秒 5 积分，60 秒 10 积分。分析与生成另行报价。" : "A video link import counts only after parsing and storage succeed, with no extra credits. Failures do not count; repeated requests do not count twice. One slot is held while processing and released on failure. Shot splitting costs 1 credit per started 6 seconds: 5 for 30 seconds, 10 for 60. Analysis and generation are quoted separately."}</p>
          </div>
        </div>
      </div>
      {selected && waffoPackages.includes(selected.id) && <WaffoCheckoutDialog key={`waffo:${selected.id}:${selectedCurrency}`} pack={selected} currency={selectedCurrency} requestId={requestIds.current[`${selected.id}:${selectedCurrency}`]} onClose={() => setSelected(null)} onPaid={() => {
        delete requestIds.current[`${selected.id}:${selectedCurrency}`];
        try { localStorage.removeItem(`promptlens:waffo-checkout:${session?.user.id || "current"}:${selected.id}:${selectedCurrency}`); } catch { /* A fresh request ID is kept in memory. */ }
      }} />}
      {selected && !waffoPackages.includes(selected.id) && <AlipayCheckoutDialog key={`${selected.id}:${checkoutAttempt}`} pack={{ ...selected, name: zh ? selected.name : ["Starter", "Creator", "Volume"][COMMERCIAL_PACKAGES.findIndex((pack) => pack.id === selected.id)] }} requestId={requestIds.current[selected.id]} previousOrderUnconfirmed={previousOrderUnconfirmed} onClose={() => setSelected(null)} onNewOrder={(previous) => {
        setPreviousOrderUnconfirmed(previous?.status === "pending");
        requestIds.current[selected.id] = crypto.randomUUID();
        try { localStorage.setItem(`promptlens:checkout:${session?.user.id || "current"}:${selected.id}`, requestIds.current[selected.id]); } catch { /* Keep the in-memory ID when storage is unavailable. */ }
        setCheckoutAttempt((value) => value + 1);
      }} onCancelled={() => {
        delete requestIds.current[selected.id];
        try { localStorage.removeItem(`promptlens:checkout:${session?.user.id || "current"}:${selected.id}`); } catch { /* Use a fresh in-memory ID on the next purchase. */ }
      }} onPaid={() => {
        delete requestIds.current[selected.id];
        try { localStorage.removeItem(`promptlens:checkout:${session?.user.id || "current"}:${selected.id}`); } catch { /* Storage may be unavailable in private browsing. */ }
      }} />}
    </section>
  );
}


