"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    trackVisit();
  }, []);

  return null;
}
