"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/auth-client";

export type WalletBalance = { credits: number; rewrites: number; heldCredits: number; heldRewrites: number; frozen: boolean; refundHeldCredits?: number };
export const WALLET_CHANGED = "wallet-balance-changed";

export function refreshWalletBalance() {
  window.dispatchEvent(new Event(WALLET_CHANGED));
}

export function useWalletBalance() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const [state, setState] = useState<{ userId?: string; wallet: WalletBalance | null; failed: boolean }>({ wallet: null, failed: false });
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let request: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      request?.abort();
      clearTimeout(timeout);
      const current = new AbortController();
      request = current;
      timeout = setTimeout(() => current.abort(), 15000);
      try {
        const response = await fetch("/api/payments/account?balanceOnly=1", { cache: "no-store", signal: current.signal });
        if (!response.ok) throw new Error("Balance unavailable");
        const { wallet } = await response.json();
        if (!wallet || !Number.isFinite(wallet.credits)) throw new Error("Invalid balance");
        if (active && request === current) setState({ userId, wallet, failed: false });
      } catch {
        if (active && request === current) setState({ userId, wallet: null, failed: true });
      } finally {
        if (request === current) { clearTimeout(timeout); request = undefined; }
      }
    };
    const onChange = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") onChange(); };
    onChange();
    const interval = setInterval(() => { if (!request) onVisible(); }, 10000);
    window.addEventListener(WALLET_CHANGED, onChange);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      request?.abort();
      clearTimeout(timeout);
      clearInterval(interval);
      window.removeEventListener(WALLET_CHANGED, onChange);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
  return state.userId === userId && userId ? state : { wallet: null, failed: false };
}
