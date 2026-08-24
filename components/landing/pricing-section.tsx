"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

const pricingKeys = ["pricingByok", "pricingLong", "pricingStandard", "pricingPro", "pricingCreation"] as const;
const packageByPricingKey: Partial<Record<(typeof pricingKeys)[number], string>> = {
  pricingLong: "starter_10",
  pricingStandard: "studio_80",
  pricingPro: "pro_220",
  pricingCreation: "creation_360",
};

const paymentMethods = [
  { id: "alipay", label: "支付宝", image: "/images/payment-alipay.jpg" },
  { id: "wechat", label: "微信", image: "/images/payment-wechat.jpg" },
] as const;

type ManualPaymentMethod = (typeof paymentMethods)[number]["id"];
type ManualPaymentSelection = {
  packageId: string;
  packageName: string;
  priceLabel: string;
};

export function PricingSection({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const isZh = locale === "zh";
  const appHref = isAuthenticated ? "/dashboard" : "/login";
  const settingsHref = isAuthenticated ? "/dashboard?tab=settings" : `/login?next=${encodeURIComponent("/dashboard?tab=settings")}`;
  const [checkoutKey, setCheckoutKey] = useState<string>("");
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [manualPayment, setManualPayment] = useState<ManualPaymentSelection | null>(null);
  const [manualMethod, setManualMethod] = useState<ManualPaymentMethod>("alipay");
  const [manualReference, setManualReference] = useState("");
  const [manualContact, setManualContact] = useState("");
  const [manualNote, setManualNote] = useState("");

  function openManualPayment(packageId: string, pricingKey: (typeof pricingKeys)[number]) {
    if (!isAuthenticated) {
      window.location.href = "/login";
      return;
    }
    setCheckoutError("");
    setCheckoutNotice("");
    setManualMethod("alipay");
    setManualReference("");
    setManualContact("");
    setManualNote("");
    setManualPayment({
      packageId,
      packageName: t(`${pricingKey}Name`),
      priceLabel: t(`${pricingKey}Price`),
    });
  }

  async function submitManualPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualPayment) return;
    setCheckoutError("");
    setCheckoutNotice("");
    setCheckoutKey(`manual_qr:${manualMethod}:${manualPayment.packageId}`);
    try {
      const response = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: manualPayment.packageId,
          method: manualMethod,
          paymentReference: manualReference,
          contact: manualContact,
          note: manualNote,
        }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) throw new Error(data?.error || (isZh ? "提交付款信息失败" : "Failed to submit payment info"));
      setCheckoutNotice(
        isZh
          ? `付款信息已提交，平台确认到账后会自动发放积分。订单号：${data?.order?.orderId || "-"}`
          : `Payment info submitted. Credits will be issued after platform confirmation. Order: ${data?.order?.orderId || "-"}`
      );
      setManualPayment(null);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : isZh ? "提交付款信息失败" : "Failed to submit payment info");
    } finally {
      setCheckoutKey("");
    }
  }

  const submittingManual = checkoutKey.startsWith("manual_qr");

  return (
    <section id="pricing" className="bg-[#F7F1E8] py-16 md:py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 md:px-6 lg:px-8">
        <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            {t("pricingTag")}
          </p>
          <h2 className="font-serif-display text-3xl font-normal text-[var(--color-text-primary)] md:text-4xl">
            {t("pricingTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[var(--color-text-secondary)] md:text-lg">
            {t("pricingSubtitle")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {pricingKeys.map((key) => {
            const highlighted = key === "pricingCreation";
            const packageId = packageByPricingKey[key];
            return (
              <article
                key={key}
                className={`flex min-h-[390px] flex-col rounded-2xl border bg-[var(--color-bg-base)] p-5 shadow-sm ${
                  highlighted ? "border-[#D97757] ring-2 ring-[#D97757]/20" : "border-[var(--color-border-subtle)]"
                }`}
              >
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-secondary)]">{t(`${key}Eyebrow`)}</p>
                    <h3 className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">{t(`${key}Name`)}</h3>
                  </div>
                  {highlighted ? (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#D97757] text-white">
                      <Sparkles className="h-4 w-4" />
                    </span>
                  ) : null}
                </div>

                <div className="mb-5">
                  <p className="font-serif-display text-3xl font-normal text-[var(--color-text-primary)]">{t(`${key}Price`)}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t(`${key}Desc`)}</p>
                </div>

                <ul className="mb-6 space-y-3 text-sm text-[var(--color-text-secondary)]">
                  {[1, 2, 3].map((index) => (
                    <li key={index} className="flex gap-2 leading-relaxed">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#D97757]" />
                      <span>{t(`${key}Bullet${index}`)}</span>
                    </li>
                  ))}
                </ul>

                {packageId ? (
                  <Button
                    type="button"
                    disabled={Boolean(checkoutKey)}
                    className={`mt-auto h-11 w-full rounded-full ${highlighted ? "bg-[#D97757] text-white hover:bg-[#C96848]" : "bg-[#241915] text-white hover:bg-[#3A2A24]"}`}
                    onClick={() => openManualPayment(packageId, key)}
                  >
                    {isZh ? "从这里开始" : "Start here"}
                  </Button>
                ) : (
                  <Link href={key === "pricingByok" ? settingsHref : appHref} className="mt-auto">
                    <Button className={`w-full rounded-full ${highlighted ? "bg-[#D97757] text-white hover:bg-[#C96848]" : "bg-[#241915] text-white hover:bg-[#3A2A24]"}`}>
                      {t(`${key}Cta`)}
                    </Button>
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        {checkoutNotice ? <p className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{checkoutNotice}</p> : null}
        {checkoutError ? <p className="mt-4 rounded-xl border border-red-500/25 bg-red-50 px-4 py-3 text-sm text-red-700">{checkoutError}</p> : null}

        <div className="mt-8 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-5 md:p-6">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">{t("pricingRulesTag")}</p>
              <h3 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">{t("pricingRulesTitle")}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t("pricingRulesDesc")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {["pricingRuleShort", "pricingRuleLong", "pricingRuleScope"].map((key) => (
                <div key={key} className="rounded-xl bg-[#F7F1E8] p-4">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t(`${key}Title`)}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t(`${key}Desc`)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {manualPayment ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 px-4 py-6">
          <div className="relative w-full max-w-4xl rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-5 shadow-2xl md:p-6">
            <button
              type="button"
              onClick={() => setManualPayment(null)}
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              aria-label={isZh ? "关闭" : "Close"}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="pr-10">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Manual QR payment</p>
              <h3 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">{isZh ? "扫码付款后提交信息" : "Submit after QR payment"}</h3>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{manualPayment.packageName} · {manualPayment.priceLabel}</p>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                {paymentMethods.map((method) => {
                  const selected = manualMethod === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setManualMethod(method.id)}
                      className={`rounded-2xl border bg-white p-3 text-left shadow-sm transition ${selected ? "border-[#D97757] ring-2 ring-[#D97757]/20" : "border-[var(--color-border-subtle)] hover:border-[#D97757]/50"}`}
                    >
                      <div className="flex items-center justify-between gap-3 pb-2">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{method.label}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selected ? "bg-[#D97757] text-white" : "bg-[#F7F1E8] text-[var(--color-text-secondary)]"}`}>
                          {selected ? (isZh ? "已选择" : "Selected") : (isZh ? "选择" : "Select")}
                        </span>
                      </div>
                      <img src={method.image} alt={`${method.label}收款码`} className="aspect-square w-full rounded-xl border border-[var(--color-border-subtle)] bg-white object-contain" />
                    </button>
                  );
                })}
              </div>
              <form onSubmit={submitManualPayment} className="grid content-start gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[#F7F1E8] p-4">
                <div className="rounded-xl bg-white px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                  {isZh ? `当前选择：${paymentMethods.find((item) => item.id === manualMethod)?.label}` : `Selected: ${paymentMethods.find((item) => item.id === manualMethod)?.label}`}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-reference">{isZh ? "付款备注/流水号" : "Payment note or transaction ID"}</Label>
                  <Input id="manual-reference" value={manualReference} onChange={(event) => setManualReference(event.target.value)} placeholder={isZh ? "例如付款昵称、订单号、转账备注" : "Nickname, order ID, or transfer note"} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-contact">{isZh ? "联系方式" : "Contact"}</Label>
                  <Input id="manual-contact" value={manualContact} onChange={(event) => setManualContact(event.target.value)} placeholder={isZh ? "邮箱、微信号或手机号，方便核对" : "Email, WeChat ID, or phone"} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-note">{isZh ? "补充说明" : "Note"}</Label>
                  <Input id="manual-note" value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder={isZh ? "可选" : "Optional"} />
                </div>
                <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {isZh ? "至少填写付款备注/流水号或联系方式其中一项。平台确认到账后，积分会自动发放到当前登录账号" : "Enter at least a payment note or contact. Credits are issued to this logged-in account after platform confirmation"}
                </p>
                <Button type="submit" disabled={submittingManual} className="mt-1 bg-[#D97757] text-white hover:bg-[#C96848]">
                  {submittingManual ? <Spinner size="sm" className="mr-2" /> : null}
                  {isZh ? "提交付款信息" : "Submit payment info"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}


