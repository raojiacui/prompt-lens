"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth/auth-client";

function trackVisit() {
  if (typeof window === "undefined") return;

  const path = window.location.pathname;
  fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    keepalive: true,
  }).catch(() => {
    // silently fail; visit tracking is best-effort
  });
}

export function VisitTracker() {
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  useEffect(() => {
    if (isPending) return;
    trackVisit();
    const trackVisible = () => { if (document.visibilityState === "visible") trackVisit(); };
    document.addEventListener("visibilitychange", trackVisible);
    const timer = window.setInterval(trackVisible, 5 * 60_000);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", trackVisible); };
  }, [pathname, session?.user?.id, isPending]);

  return null;
}
