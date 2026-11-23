import React from "react";

export type ReceivedGift = { id: string; credits: number; rewrites: number; linkImports: number; note: string | null;
  createdAt: string; expiresAt: string | null; availableCredits: number; availableRewrites: number };

export function ReceivedGifts({ gifts, zh }: { gifts: ReceivedGift[]; zh: boolean }) {
  if (!gifts.length) return null;
  const locale = zh ? "zh-CN" : "en-US";
  return <section aria-label={zh ? "管理员赠送权益" : "Benefits gifted by an administrator"} className="mb-8 space-y-3">
    <h2 className="text-lg font-semibold">{zh ? "管理员赠送权益" : "Gifts from an administrator"}</h2>
    {gifts.map(gift => {
      const expired = gift.expiresAt !== null && new Date(gift.expiresAt).getTime() <= Date.now();
      return <article key={gift.id} className="rounded-lg border border-border bg-[var(--color-bg-raised)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{zh ? "管理员赠送" : "Gifted by an administrator"}</p>
          <span className={`text-sm ${expired ? "text-muted-foreground" : "text-emerald-700"}`}>{expired ? (zh ? "已到期" : "Expired") : (zh ? "有效" : "Active")}</span>
        </div>
        <p className="mt-3 text-sm">{gift.credits} {zh ? "通用积分" : "credits"} · {gift.rewrites} {zh ? "次 AI 改写" : "AI rewrites"} · {gift.linkImports} {zh ? "次链接导入" : "link imports"}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm"><span className="text-muted-foreground">{zh ? "发放原因：" : "Reason: "}</span>{gift.note?.trim() || (zh ? "管理员未填写备注" : "No note provided")}</p>
        <p className="mt-3 text-sm text-muted-foreground">{zh ? "发放时间：" : "Granted: "}{new Date(gift.createdAt).toLocaleString(locale)}</p>
        {gift.expiresAt && <p className="mt-1 text-sm text-muted-foreground">{zh ? "到期时间：" : "Expires: "}{new Date(gift.expiresAt).toLocaleString(locale)}</p>}
        <p className="mt-2 text-sm text-muted-foreground">{zh ? "剩余可用：" : "Available: "}{expired ? 0 : gift.availableCredits} {zh ? "积分" : "credits"} · {expired ? 0 : gift.availableRewrites} {zh ? "次改写" : "rewrites"}</p>
      </article>;
    })}
  </section>;
}
