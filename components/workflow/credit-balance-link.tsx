import React from "react";
import Link from "next/link";
import { Coins } from "lucide-react";

export function CreditBalanceLink({ status, failed, locale }: {
  status: { balance: number; commercial?: { credits?: number; heldCredits?: number } } | null;
  failed: boolean;
  locale: string;
}) {
  const zh = locale !== "en";
  const commercialCredits = status?.commercial?.credits;
  const credits = commercialCredits ?? status?.balance;
  return <Link href="/billing" className="ml-auto inline-flex min-h-11 shrink-0 flex-col items-end justify-center gap-1 text-sm text-foreground underline-offset-4 hover:underline" title={zh ? "查看余额与订单" : "View balance and orders"}>
    <span className="inline-flex items-center gap-2"><Coins size={18} aria-hidden="true" />
      {zh ? "积分余额" : "Credit balance"}: {failed ? (zh ? "暂不可用" : "Unavailable") : credits === undefined ? (zh ? "加载中…" : "Loading…") : credits.toLocaleString(zh ? "zh-CN" : "en-US")}
    </span>
    {!failed && !!status?.commercial?.heldCredits && <span className="text-xs text-muted-foreground">{zh ? "任务预留" : "Reserved"}: {status.commercial.heldCredits.toLocaleString(zh ? "zh-CN" : "en-US")}</span>}
    {status && commercialCredits !== undefined && status.balance > 0 && <span className="text-xs text-muted-foreground">{zh ? "原版积分" : "Legacy credits"}: {status.balance.toLocaleString(zh ? "zh-CN" : "en-US")}</span>}
  </Link>;
}
